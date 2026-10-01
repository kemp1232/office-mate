-- =====================================================================================
-- Team member management (Admin):
--   * first / last names (users.name stays "First Last" for Better Auth, the log and the Sheet)
--   * the team list, prefilled; the Admin can add and edit members before they ever sign in
--   * per-member Clock Out rule: a fixed time, or required hours after Clock In
--   * a today-only Admin override that locks or unlocks Clock Out
--   * deactivation (no sign in, no clocking, sessions ended; history kept)
--
-- Members the Admin adds are stored with email_verified = true: the Admin vouches for the
-- address, and Better Auth only links a first Google sign-in (same email, Google-verified,
-- hd=firstmate.tech) to an existing row that is verified. Before that sign-in they have no
-- account row, so nobody can use them. The Admin account itself is never linkable (app hook).
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- Names + deactivation
-- ---------------------------------------------------------------------------------
alter table app.users
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column deactivated_at timestamptz,
  add constraint users_name_lengths
    check (char_length(first_name) <= 100 and char_length(last_name) <= 100);

-- First/last names are the source of truth; `name` is always derived from them. A row written
-- with only `name` (e.g. a Google profile without given/family names) gets it split instead:
-- "Kemp Steven Sayson" → ("Kemp Steven", "Sayson"); a single word is a first name.
-- (Self-contained: it fires for attendance_app, which can't execute app helpers.)
create function app.users_sync_name() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_full text := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
begin
  new.first_name := btrim(regexp_replace(coalesce(new.first_name, ''), '\s+', ' ', 'g'));
  new.last_name := btrim(regexp_replace(coalesce(new.last_name, ''), '\s+', ' ', 'g'));
  if new.first_name = '' and new.last_name = '' then
    if position(' ' in v_full) > 0 then
      new.first_name := regexp_replace(v_full, ' \S+$', '');
      new.last_name := substring(v_full from '\S+$');
    else
      new.first_name := v_full;
    end if;
  end if;
  new.name := btrim(concat_ws(' ', nullif(new.first_name, ''), nullif(new.last_name, '')));
  return new;
end;
$$;

create trigger users_sync_name
  before insert or update on app.users
  for each row execute function app.users_sync_name();

-- Existing accounts (including people who already signed in with Google): split their name.
update app.users set first_name = '', last_name = '';

-- The team list. Existing emails only get their names updated.
insert into app.users (name, first_name, last_name, email, email_verified, updated_at) values
  ('', 'Aemielvin', 'Loremia', 'aemielvinloremia@firstmate.tech', true, now()),
  ('', 'Bernieson', 'Sahagun', 'berniesonsahagun@firstmate.tech', true, now()),
  ('', 'Carlos Miguel', 'Canonizado', 'carloscanonizado@firstmate.tech', true, now()),
  ('', 'Daniel', 'Nebreja', 'danielnebreja@firstmate.tech', true, now()),
  ('', 'Edovanie Jr.', 'Hiramis', 'edhiramis@firstmate.tech', true, now()),
  ('', 'Jake', 'Zozobrado', 'jakezozobrado@firstmate.tech', true, now()),
  ('', 'Jed Laszlo', 'Jocson', 'jedjocson@firstmate.tech', true, now()),
  ('', 'Jessa Mae', 'Abella', 'jessaabella@firstmate.tech', true, now()),
  ('', 'Joanne Frances', 'Perez', 'joanneperez@firstmate.tech', true, now()),
  ('', 'John Dominic', 'Lagarde', 'johnlagarde@firstmate.tech', true, now()),
  ('', 'Jose III', 'Maglaque', 'josemaglaque@firstmate.tech', true, now()),
  ('', 'Kemp Steven', 'Sayson', 'kempsayson@firstmate.tech', true, now()),
  ('', 'Kobe Bryant', 'Ruado', 'koberuado@firstmate.tech', true, now()),
  ('', 'Leandro', 'Esparrago', 'eanesparrago@firstmate.tech', true, now()),
  ('', 'Mark Andrew', 'Yao', 'markyao@firstmate.tech', true, now()),
  ('', 'Matthew Seaver', 'Choy', 'seaverchoy@firstmate.tech', true, now()),
  ('', 'Nieves', 'Montoya', 'nievesmontoya@firstmate.tech', true, now()),
  ('', 'Omar', 'Salam', 'omarsalam@firstmate.tech', true, now()),
  ('', 'Paul Grant', 'Ilaga', 'paulilaga@firstmate.tech', true, now()),
  ('', 'Raymund Adrian', 'Rafael', 'adrianrafael@firstmate.tech', true, now()),
  ('', 'Rodolfo', 'Mercado', 'jaymercado@firstmate.tech', true, now()),
  ('', 'Rustan Angeli', 'Marco', 'rustanmarco@firstmate.tech', true, now()),
  ('', 'Samuel Kirby', 'Aguilar', 'kirbyaguilar@firstmate.tech', true, now()),
  ('', 'Seth Charles', 'Palileo', 'sethpalileo@firstmate.tech', true, now())
on conflict (email) do update
  set first_name = excluded.first_name, last_name = excluded.last_name, updated_at = now();

-- A deactivated member is no longer a Team Member: no attendance state, no clocking.
create or replace function app.team_member_email(p_user_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select u.email from app.users u
  where u.id = p_user_id
    and u.email_verified
    and u.deactivated_at is null
    and split_part(u.email, '@', 2) = 'firstmate.tech'
    and u.email <> all (app.admin_emails());
$$;

-- ---------------------------------------------------------------------------------
-- Clock Out rules (one per member, same every office day) and today-only overrides
-- ---------------------------------------------------------------------------------
create type app.clock_out_rule_mode as enum ('TIME', 'HOURS');
create type app.clock_out_override_state as enum ('LOCKED', 'UNLOCKED');

create table app.clock_out_rules (
  user_id uuid primary key references app.users (id) on delete cascade,
  mode app.clock_out_rule_mode not null,
  -- TIME: earliest Clock Out, in the organisation timezone (whole minutes).
  clock_out_time time check (clock_out_time is null or extract(second from clock_out_time) = 0),
  -- HOURS: minutes after that day's Clock In (30 min to 16 h).
  required_minutes integer check (required_minutes between 30 and 960),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users (id) on delete set null,
  constraint clock_out_rule_shape check (
    (mode = 'TIME' and clock_out_time is not null and required_minutes is null)
    or (mode = 'HOURS' and required_minutes is not null and clock_out_time is null))
);

-- Keyed by attendance day, so an override ends by itself when the next office day starts.
create table app.clock_out_overrides (
  user_id uuid not null references app.users (id) on delete cascade,
  attendance_day date not null,
  state app.clock_out_override_state not null,
  set_at timestamptz not null default now(),
  set_by uuid references app.users (id) on delete set null,
  primary key (user_id, attendance_day)
);

alter table app.clock_out_rules enable row level security;
alter table app.clock_out_overrides enable row level security;
revoke all on app.clock_out_rules, app.clock_out_overrides from public;

-- Whether a member may clock out on p_day at p_now (internal; callers check identity).
--   status  OPEN | NOT_YET | LOCKED
--   opens_at  earliest Clock Out under the rule (null without a rule, or HOURS before Clock In)
create function app.clock_out_gate(
  p_user_id uuid, p_day date, p_timezone text, p_clock_in timestamptz, p_now timestamptz
) returns jsonb
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  r app.clock_out_rules;
  v_override app.clock_out_override_state;
  v_opens timestamptz;
begin
  select * into r from app.clock_out_rules where user_id = p_user_id;
  select o.state into v_override from app.clock_out_overrides o
  where o.user_id = p_user_id and o.attendance_day = p_day;

  if r.mode = 'TIME' then
    v_opens := (p_day + r.clock_out_time) at time zone p_timezone;
  elsif r.mode = 'HOURS' then
    v_opens := p_clock_in + make_interval(mins => r.required_minutes);
  end if;

  return jsonb_build_object(
    'status', case
      when v_override = 'LOCKED' then 'LOCKED'
      when v_override = 'UNLOCKED' then 'OPEN'
      when r.user_id is null then 'OPEN'
      when v_opens is null or p_now < v_opens then 'NOT_YET'
      else 'OPEN'
    end,
    'opens_at', v_opens,
    'override', v_override,
    'rule', case
      when r.user_id is null then null
      when r.mode = 'TIME' then jsonb_build_object('mode', 'TIME', 'clock_out_time', to_char(r.clock_out_time, 'HH24:MI'))
      else jsonb_build_object('mode', 'HOURS', 'required_minutes', r.required_minutes)
    end
  );
end;
$$;

-- The member state payload: today's events + next action (state_json) + the Clock Out gate.
create function app.member_state(
  p_settings app.attendance_settings, p_user_id uuid, p_day date, p_timezone text,
  p_in timestamptz, p_out timestamptz
) returns jsonb
language sql stable set search_path = pg_catalog, pg_temp as $$
  select app.state_json(p_settings, p_day, p_timezone, p_in, p_out)
    || jsonb_build_object('clock_out', app.clock_out_gate(p_user_id, p_day, p_timezone, p_in, clock_timestamp()));
$$;

create or replace function app.attendance_state_for(p_user_id uuid, p_timezone text, p_day date) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select app.member_state(s, p_user_id, p_day, p_timezone, e.clock_in, e.clock_out)
  from app.attendance_settings s,
       lateral (
         select max(recorded_at) filter (where event_type = 'CLOCK_IN') as clock_in,
                max(recorded_at) filter (where event_type = 'CLOCK_OUT') as clock_out
         from app.attendance_events
         where user_id = p_user_id and attendance_day = p_day
       ) e
  where s.id;
$$;

-- ---------------------------------------------------------------------------------
-- record_attendance: unchanged validation order, plus the Clock Out gate (checked under the
-- per-user/day lock, with the trusted timestamp). Refusals write nothing.
-- ---------------------------------------------------------------------------------
create or replace function app.record_attendance(
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
  v_gate jsonb;
  v_event app.attendance_events;
begin
  -- 1-2. authenticated + authorised (verified, active org account that isn't the Admin)
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
      'state', app.member_state(v_settings, p_user_id, v_day, p_timezone, v_in, v_out));
  end if;

  -- 8b. Clock Out gate: the member's rule and today's Admin override.
  if v_action = 'CLOCK_OUT' then
    v_gate := app.clock_out_gate(p_user_id, v_day, p_timezone, v_in, v_now);
    if v_gate->>'status' = 'LOCKED' then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_LOCKED',
        'state', app.member_state(v_settings, p_user_id, v_day, p_timezone, v_in, v_out));
    elsif v_gate->>'status' = 'NOT_YET' then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_TOO_EARLY',
        'opens_at', v_gate->'opens_at',
        'state', app.member_state(v_settings, p_user_id, v_day, p_timezone, v_in, v_out));
    end if;
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
    'state', app.member_state(v_settings, p_user_id, v_day, p_timezone, v_in, v_out)
  );
end;
$$;

-- ---------------------------------------------------------------------------------
-- Admin: team list + member management. The Admin is re-checked here on every call.
-- ---------------------------------------------------------------------------------

-- Everyone except the Admin account, with their rule, today's times and today's gate.
create function app.admin_team(p_user_id uuid, p_timezone text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day date;
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  v_day := app.attendance_day(v_now, p_timezone);
  return jsonb_build_object(
    'ok', true,
    'day', v_day,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id,
               'first_name', u.first_name,
               'last_name', u.last_name,
               'name', u.name,
               'email', u.email,
               'signed_in', exists (select 1 from app.accounts a where a.user_id = u.id),
               'deactivated_at', u.deactivated_at,
               'clock_in_at', e.clock_in,
               'clock_out_at', e.clock_out,
               'clock_out', app.clock_out_gate(u.id, v_day, p_timezone, e.clock_in, v_now))
             order by u.deactivated_at is not null, lower(u.first_name), lower(u.last_name), u.email)
      from app.users u
      left join lateral (
        select max(recorded_at) filter (where event_type = 'CLOCK_IN') as clock_in,
               max(recorded_at) filter (where event_type = 'CLOCK_OUT') as clock_out
        from app.attendance_events
        where user_id = u.id and attendance_day = v_day
      ) e on true
      where u.email <> all (app.admin_emails())
    ), '[]'::jsonb)
  );
end;
$$;

-- Add (p_member_id null) or edit a member: names, email, and their Clock Out rule.
-- The email can only change before the member's first sign in (it then belongs to their
-- Google account). p_rule_mode: NONE | TIME (p_clock_out_time) | HOURS (p_required_minutes).
create function app.admin_save_member(
  p_user_id uuid,
  p_member_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_rule_mode text,
  p_clock_out_time time,
  p_required_minutes integer
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_first text := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  v_last text := btrim(regexp_replace(coalesce(p_last_name, ''), '\s+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_member app.users;
  v_id uuid;
  invalid constant jsonb := jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if v_first = '' or char_length(v_first) > 100 then
    return invalid || jsonb_build_object('field', 'firstName');
  end if;
  if char_length(v_last) > 100 then
    return invalid || jsonb_build_object('field', 'lastName');
  end if;
  if v_email !~ '^[^@\s+]+@firstmate\.tech$' or v_email = any (app.admin_emails()) then
    return invalid || jsonb_build_object('field', 'email');
  end if;
  if p_rule_mode is null or p_rule_mode not in ('NONE', 'TIME', 'HOURS') then
    return invalid || jsonb_build_object('field', 'rule');
  end if;
  if p_rule_mode = 'TIME' and (p_clock_out_time is null or extract(second from p_clock_out_time) <> 0) then
    return invalid || jsonb_build_object('field', 'clockOutTime');
  end if;
  if p_rule_mode = 'HOURS' and (p_required_minutes is null or p_required_minutes not between 30 and 960) then
    return invalid || jsonb_build_object('field', 'requiredHours');
  end if;

  if p_member_id is null then
    begin
      insert into app.users (name, first_name, last_name, email, email_verified, updated_at)
      values ('', v_first, v_last, v_email, true, now())
      returning id into v_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN', 'field', 'email');
    end;
  else
    select * into v_member from app.users where id = p_member_id for update;
    if not found or v_member.email = any (app.admin_emails()) then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    if v_member.email <> v_email and exists (select 1 from app.accounts where user_id = p_member_id) then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_LOCKED', 'field', 'email');
    end if;
    begin
      update app.users
      set first_name = v_first, last_name = v_last, email = v_email, updated_at = now()
      where id = p_member_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN', 'field', 'email');
    end;
    v_id := p_member_id;
  end if;

  if p_rule_mode = 'NONE' then
    delete from app.clock_out_rules where user_id = v_id;
  else
    insert into app.clock_out_rules (user_id, mode, clock_out_time, required_minutes, updated_by)
    values (
      v_id, p_rule_mode::app.clock_out_rule_mode,
      case when p_rule_mode = 'TIME' then p_clock_out_time end,
      case when p_rule_mode = 'HOURS' then p_required_minutes end,
      p_user_id)
    on conflict (user_id) do update set
      mode = excluded.mode,
      clock_out_time = excluded.clock_out_time,
      required_minutes = excluded.required_minutes,
      updated_at = now(),
      updated_by = excluded.updated_by;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Lock or unlock a member's Clock Out for today only, or go back to their rule.
-- p_state: LOCKED | UNLOCKED | FOLLOW_RULE.
create function app.admin_set_clock_out_override(
  p_user_id uuid, p_member_id uuid, p_state text, p_timezone text
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_day date;
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_state is null or p_state not in ('LOCKED', 'UNLOCKED', 'FOLLOW_RULE') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if not exists (select 1 from app.users where id = p_member_id and email <> all (app.admin_emails())) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_day := app.attendance_day(clock_timestamp(), p_timezone);
  if p_state = 'FOLLOW_RULE' then
    delete from app.clock_out_overrides where user_id = p_member_id and attendance_day = v_day;
  else
    insert into app.clock_out_overrides (user_id, attendance_day, state, set_by)
    values (p_member_id, v_day, p_state::app.clock_out_override_state, p_user_id)
    on conflict (user_id, attendance_day) do update set
      state = excluded.state, set_at = now(), set_by = excluded.set_by;
  end if;
  return jsonb_build_object('ok', true, 'day', v_day);
end;
$$;

-- Deactivate (signs them out everywhere; their attendance history stays) or reactivate.
create function app.admin_set_member_active(p_user_id uuid, p_member_id uuid, p_active boolean)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_active is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if not exists (select 1 from app.users where id = p_member_id and email <> all (app.admin_emails())) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if p_active then
    update app.users set deactivated_at = null, updated_at = now() where id = p_member_id;
  else
    update app.users set deactivated_at = coalesce(deactivated_at, now()), updated_at = now()
    where id = p_member_id;
    delete from app.sessions where user_id = p_member_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on all functions in schema app from public;
grant execute on function
  app.admin_team(uuid, text),
  app.admin_save_member(uuid, uuid, text, text, text, text, time, integer),
  app.admin_set_clock_out_override(uuid, uuid, text, text),
  app.admin_set_member_active(uuid, uuid, boolean)
to attendance_app;
