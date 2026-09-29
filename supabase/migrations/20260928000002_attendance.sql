-- =====================================================================================
-- Attendance domain: settings singleton, immutable events, and the trust-boundary
-- functions that validate geofence + derive the next action atomically.
--
-- Trust model: the Next.js server authenticates the user (Better Auth) and calls these
-- SECURITY DEFINER functions as the least-privilege `attendance_app` role, passing the
-- authenticated user id. The functions re-derive everything else themselves:
--   * email / domain / verification come from app.users, never from the caller
--   * event type is derived from today's rows, never from the caller
--   * timestamps come from now(), attendance day from now() in the org timezone
--   * distance + pass/fail are computed here from server-controlled settings
-- attendance_app has NO direct table privileges on attendance tables.
-- =====================================================================================

create type app.attendance_event_type as enum ('CLOCK_IN', 'CLOCK_OUT');
create type app.attendance_source as enum ('DIRECT', 'QR');

-- ---------------------------------------------------------------------------------
-- Settings (exactly one row)
-- ---------------------------------------------------------------------------------
create table app.attendance_settings (
  id boolean primary key default true check (id),
  office_latitude double precision
    check (office_latitude between -90 and 90),
  office_longitude double precision
    check (office_longitude between -180 and 180),
  radius_m integer not null default 300
    check (radius_m between 10 and 5000),
  accuracy_threshold_m integer not null default 50
    check (accuracy_threshold_m between 5 and 1000),
  report_url text not null
    default 'https://docs.google.com/spreadsheets/d/1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME/edit?usp=sharing'
    check (report_url ~ '^https://[^\s]+$' and char_length(report_url) <= 2048),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users (id) on delete set null,
  constraint office_both_or_neither
    check ((office_latitude is null) = (office_longitude is null))
);

insert into app.attendance_settings (id) values (true);

-- The singleton row can never be removed.
create function app.forbid_settings_delete() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'attendance_settings row cannot be deleted' using errcode = '42501';
end;
$$;

create trigger attendance_settings_no_delete
  before delete on app.attendance_settings
  for each row execute function app.forbid_settings_delete();

create trigger attendance_settings_no_truncate
  before truncate on app.attendance_settings
  for each statement execute function app.forbid_settings_delete();

-- ---------------------------------------------------------------------------------
-- Attendance events (write once, never edited, never deleted)
-- ---------------------------------------------------------------------------------
create table app.attendance_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete restrict,
  email text not null,
  event_type app.attendance_event_type not null,
  attendance_day date not null,
  recorded_at timestamptz not null default now(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m > 0),
  distance_m double precision not null check (distance_m >= 0),
  office_latitude double precision not null,
  office_longitude double precision not null,
  radius_m integer not null,
  accuracy_threshold_m integer not null,
  geofence_result text not null default 'PASS' check (geofence_result = 'PASS'),
  source app.attendance_source not null default 'DIRECT',
  -- A stored record is self-evidently valid against the settings it was checked with.
  constraint validated_within_limits
    check (accuracy_m <= accuracy_threshold_m and distance_m <= radius_m),
  -- One Clock In and one Clock Out per user per attendance day.
  constraint one_event_type_per_day unique (user_id, attendance_day, event_type)
);

comment on table app.attendance_events is
  'Immutable attendance log. Rows are inserted only by app.record_attendance(); UPDATE/DELETE/TRUNCATE always fail.';

create function app.forbid_attendance_mutation() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'attendance records are immutable (% blocked)', tg_op using errcode = '42501';
end;
$$;

create trigger attendance_events_immutable
  before update or delete on app.attendance_events
  for each row execute function app.forbid_attendance_mutation();

create trigger attendance_events_no_truncate
  before truncate on app.attendance_events
  for each statement execute function app.forbid_attendance_mutation();

-- A Clock Out needs a Clock In on the same attendance day (Clock Ins can never be removed,
-- so this invariant can't be broken later).
create function app.require_clock_in_before_clock_out() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.event_type = 'CLOCK_OUT' and not exists (
    select 1 from app.attendance_events e
    where e.user_id = new.user_id
      and e.attendance_day = new.attendance_day
      and e.event_type = 'CLOCK_IN'
      and e.recorded_at <= new.recorded_at
  ) then
    raise exception 'clock out requires an earlier clock in on the same attendance day'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_events_clock_out_requires_clock_in
  before insert on app.attendance_events
  for each row execute function app.require_clock_in_before_clock_out();

-- ---------------------------------------------------------------------------------
-- Pure helpers
-- ---------------------------------------------------------------------------------

-- Attendance day = calendar date of `ts` in the organisation timezone.
-- (AT TIME ZONE raises 22023 for unknown zones; avoid scanning pg_timezone_names on the hot path.)
create function app.attendance_day(ts timestamptz, tz text) returns date
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
begin
  if tz is null or tz = '' then
    raise exception 'invalid attendance timezone: %', tz using errcode = '22023';
  end if;
  return (ts at time zone tz)::date;
end;
$$;

-- Great-circle distance in metres (Haversine, IUGG mean Earth radius).
create function app.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable strict parallel safe set search_path = pg_catalog, pg_temp as $$
  select 2 * 6371008.8 * asin(sqrt(least(1.0,
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- A finite, non-NaN double. (Postgres treats NaN = NaN as true, so NaN is listed explicitly.)
create function app.is_finite(v double precision) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select v is not null
     and v not in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision);
$$;

-- Hard-coded Admin allow-list (v1). Must equal ADMIN_EMAILS in src/features/auth/roles.ts
-- (tests/integration/attendance-db.test.ts compares them).
create function app.admin_emails() returns text[]
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select array['admin@firstmate.tech']::text[];
$$;

create function app.is_admin(p_user_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from app.users u
    where u.id = p_user_id
      and u.email_verified
      and u.email = any (app.admin_emails())
  );
$$;

-- The email of a verified account in the organisation domain, else null.
create function app.team_member_email(p_user_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select u.email from app.users u
  where u.id = p_user_id
    and u.email_verified
    and split_part(u.email, '@', 2) = 'firstmate.tech';
$$;

-- Serialises attendance writes for one user and day.
create function app.lock_user_day(p_user_id uuid, p_day date) returns void
language sql volatile set search_path = pg_catalog, pg_temp as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attendance:' || p_user_id::text || ':' || p_day::text, 0));
$$;

-- ---------------------------------------------------------------------------------
-- State for today (authoritative next action)
-- ---------------------------------------------------------------------------------
-- Pure builder for the state payload returned to the app.
create function app.state_json(
  p_settings app.attendance_settings, p_day date, p_timezone text, p_in timestamptz, p_out timestamptz
) returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'configured', p_settings.office_latitude is not null,
    'attendance_day', p_day,
    'timezone', p_timezone,
    'clock_in_at', p_in,
    'clock_out_at', p_out,
    'next_action', case
      when p_in is null then 'CLOCK_IN'
      when p_out is null then 'CLOCK_OUT'
      else 'DAY_COMPLETE'
    end,
    'radius_m', p_settings.radius_m,
    'accuracy_threshold_m', p_settings.accuracy_threshold_m
  );
$$;

-- Internal: state for an explicit attendance day (no authorisation check).
create function app.attendance_state_for(p_user_id uuid, p_timezone text, p_day date) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select app.state_json(s, p_day, p_timezone, e.clock_in, e.clock_out)
  from app.attendance_settings s,
       lateral (
         select max(recorded_at) filter (where event_type = 'CLOCK_IN') as clock_in,
                max(recorded_at) filter (where event_type = 'CLOCK_OUT') as clock_out
         from app.attendance_events
         where user_id = p_user_id and attendance_day = p_day
       ) e
  where s.id;
$$;

create function app.get_attendance_state(p_user_id uuid, p_timezone text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if app.team_member_email(p_user_id) is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return app.attendance_state_for(p_user_id, p_timezone, app.attendance_day(clock_timestamp(), p_timezone));
end;
$$;

-- ---------------------------------------------------------------------------------
-- The one write path for attendance.
-- Rejections are RETURNED (no row written); only success inserts.
-- p_expected_action is a precondition, not an instruction: if it differs from the
-- server-derived action, nothing is written and STATE_CHANGED is returned. This makes
-- double-taps and network retries safe (a retried Clock In never becomes a Clock Out).
-- ---------------------------------------------------------------------------------
create function app.record_attendance(
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_source text,
  p_expected_action text,
  p_timezone text
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz;
  v_day date;
  v_email text;
  v_settings app.attendance_settings;
  v_distance double precision;
  v_in timestamptz;
  v_out timestamptz;
  v_action app.attendance_event_type;
  v_event app.attendance_events;
begin
  -- 1-2. authenticated + authorised (verified org account)
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  v_email := app.team_member_email(p_user_id);
  if v_email is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  v_day := app.attendance_day(clock_timestamp(), p_timezone);

  -- 3. configured
  select * into v_settings from app.attendance_settings where id;
  if v_settings.office_latitude is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_CONFIGURED');
  end if;

  -- 4. input validation
  if not (app.is_finite(p_latitude) and app.is_finite(p_longitude) and app.is_finite(p_accuracy_m))
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or p_accuracy_m <= 0 or p_accuracy_m > 100000
     or p_source is null or p_source not in ('DIRECT', 'QR')
     or p_expected_action is null or p_expected_action not in ('CLOCK_IN', 'CLOCK_OUT') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- 5. accuracy BEFORE radius
  if p_accuracy_m > v_settings.accuracy_threshold_m then
    return jsonb_build_object('ok', false, 'code', 'ACCURACY_TOO_LOW',
      'accuracy_m', round(p_accuracy_m::numeric, 1),
      'accuracy_threshold_m', v_settings.accuracy_threshold_m);
  end if;

  -- 6-7. geofence
  v_distance := app.distance_m(p_latitude, p_longitude,
                               v_settings.office_latitude, v_settings.office_longitude);
  if v_distance > v_settings.radius_m then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_GEOFENCE',
      'distance_m', round(v_distance::numeric),
      'radius_m', v_settings.radius_m);
  end if;

  -- 8. serialise per user+day, then derive the action from committed state.
  perform app.lock_user_day(p_user_id, v_day);
  -- The trusted timestamp is taken AFTER the lock, so a request that waited behind another
  -- can never be stamped earlier than the event it waited for.
  v_now := clock_timestamp();
  if app.attendance_day(v_now, p_timezone) <> v_day then
    -- Crossed midnight while waiting: serialise on the new day instead.
    v_day := app.attendance_day(v_now, p_timezone);
    perform app.lock_user_day(p_user_id, v_day);
  end if;

  select
    max(recorded_at) filter (where event_type = 'CLOCK_IN'),
    max(recorded_at) filter (where event_type = 'CLOCK_OUT')
  into v_in, v_out
  from app.attendance_events
  where user_id = p_user_id and attendance_day = v_day;

  v_action := case
    when v_in is null then 'CLOCK_IN'
    when v_out is null then 'CLOCK_OUT'
  end;

  if v_action is distinct from p_expected_action::app.attendance_event_type then
    return jsonb_build_object('ok', false, 'code', 'STATE_CHANGED',
      'state', app.state_json(v_settings, v_day, p_timezone, v_in, v_out));
  end if;

  -- 9. atomic insert with server timestamp + validation snapshot
  begin
    insert into app.attendance_events (
      user_id, email, event_type, attendance_day, recorded_at,
      latitude, longitude, accuracy_m, distance_m,
      office_latitude, office_longitude, radius_m, accuracy_threshold_m,
      geofence_result, source
    ) values (
      p_user_id, v_email, v_action, v_day, v_now,
      p_latitude, p_longitude, p_accuracy_m, v_distance,
      v_settings.office_latitude, v_settings.office_longitude,
      v_settings.radius_m, v_settings.accuracy_threshold_m,
      'PASS', p_source::app.attendance_source
    ) returning * into v_event;
  exception when unique_violation then
    -- Only reachable if the lock were bypassed; report whatever is committed now.
    return jsonb_build_object('ok', false, 'code', 'STATE_CHANGED',
      'state', app.attendance_state_for(p_user_id, p_timezone, v_day));
  end;

  if v_action = 'CLOCK_IN' then v_in := v_now; else v_out := v_now; end if;
  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', v_event.id,
      'event_type', v_event.event_type,
      'recorded_at', v_event.recorded_at,
      'accuracy_m', round(v_event.accuracy_m::numeric, 1),
      'distance_m', round(v_event.distance_m::numeric)
    ),
    'state', app.state_json(v_settings, v_day, p_timezone, v_in, v_out)
  );
end;
$$;

-- ---------------------------------------------------------------------------------
-- Admin settings (read + update), Admin checked inside the database as well.
-- ---------------------------------------------------------------------------------
create function app.get_admin_settings(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v app.attendance_settings;
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select * into v from app.attendance_settings where id;
  return jsonb_build_object(
    'ok', true,
    'office_latitude', v.office_latitude,
    'office_longitude', v.office_longitude,
    'radius_m', v.radius_m,
    'accuracy_threshold_m', v.accuracy_threshold_m,
    'report_url', v.report_url,
    'updated_at', v.updated_at
  );
end;
$$;

create function app.update_admin_settings(
  p_user_id uuid,
  p_office_latitude double precision,
  p_office_longitude double precision,
  p_radius_m integer,
  p_accuracy_threshold_m integer,
  p_report_url text
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if (p_office_latitude is null) <> (p_office_longitude is null)
     or (p_office_latitude is not null and not (app.is_finite(p_office_latitude) and app.is_finite(p_office_longitude))) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  begin
    update app.attendance_settings set
      office_latitude = p_office_latitude,
      office_longitude = p_office_longitude,
      radius_m = p_radius_m,
      accuracy_threshold_m = p_accuracy_threshold_m,
      report_url = p_report_url,
      updated_at = now(),
      updated_by = p_user_id
    where id;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end;

  return app.get_admin_settings(p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Privileges: the app role may only EXECUTE the public entry points.
-- ---------------------------------------------------------------------------------
alter table app.attendance_settings enable row level security;
alter table app.attendance_events enable row level security;

revoke all on app.attendance_settings, app.attendance_events from public;
revoke execute on all functions in schema app from public;

grant execute on function
  app.get_attendance_state(uuid, text),
  app.record_attendance(uuid, double precision, double precision, double precision, text, text, text),
  app.get_admin_settings(uuid),
  app.update_admin_settings(uuid, double precision, double precision, integer, integer, text),
  app.is_admin(uuid)
to attendance_app;
