-- =====================================================================================
-- One-way Google Sheets sync (Postgres → Sheet). Postgres stays the source of truth.
--
-- Every attendance insert queues "(attendance_day, user) needs syncing" in the same
-- transaction (trigger), so no event is ever missed. A worker in the app claims queued
-- rows (short lease, SKIP LOCKED so two workers never sync the same person-day), writes
-- the person's whole row for that day from the database (idempotent), then marks the
-- version it synced. A newer event bumps `version`, so an in-flight sync of an older
-- version can't mark the newer one done.
-- =====================================================================================

create table app.sheet_sync (
  attendance_day date not null,
  user_id uuid not null references app.users (id) on delete restrict,
  version integer not null default 1,
  synced_version integer not null default 0,
  attempts integer not null default 0,
  last_error text,
  last_synced_at timestamptz,
  claimed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (attendance_day, user_id)
);

create index sheet_sync_pending_idx on app.sheet_sync (attendance_day) where synced_version < version;

alter table app.sheet_sync enable row level security;
revoke all on app.sheet_sync from public;

-- Queue a sync whenever an attendance event is written.
create function app.enqueue_sheet_sync() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into app.sheet_sync (attendance_day, user_id)
  values (new.attendance_day, new.user_id)
  on conflict (attendance_day, user_id)
  do update set version = app.sheet_sync.version + 1, updated_at = now();
  return new;
end;
$$;

create trigger attendance_events_enqueue_sheet_sync
  after insert on app.attendance_events
  for each row execute function app.enqueue_sheet_sync();

-- Backfill: queue every person-day recorded before this migration, so the Sheet gets them too.
insert into app.sheet_sync (attendance_day, user_id)
select distinct attendance_day, user_id from app.attendance_events
on conflict (attendance_day, user_id) do nothing;

-- Where to write: the Admin-configured report link (the app parses the spreadsheet id).
create function app.sheet_sync_target() returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select report_url from app.attendance_settings where id;
$$;

-- Claim up to p_limit pending person-days and return what their sheet row should contain.
create function app.claim_sheet_sync(p_limit integer, p_lease_seconds integer)
returns table (
  attendance_day date,
  user_id uuid,
  version integer,
  name text,
  email text,
  clock_in timestamptz,
  clock_out timestamptz
)
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
begin
  return query
  with picked as (
    select s.attendance_day, s.user_id
    from app.sheet_sync s
    where s.synced_version < s.version
      and (s.claimed_until is null or s.claimed_until < now())
    order by s.attendance_day, s.updated_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ),
  claimed as (
    update app.sheet_sync s
    set claimed_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 300))),
        attempts = s.attempts + 1
    from picked p
    where s.attendance_day = p.attendance_day and s.user_id = p.user_id
    returning s.attendance_day, s.user_id, s.version
  )
  select c.attendance_day, c.user_id, c.version, u.name, u.email,
         (select max(e.recorded_at) from app.attendance_events e
           where e.user_id = c.user_id and e.attendance_day = c.attendance_day and e.event_type = 'CLOCK_IN'),
         (select max(e.recorded_at) from app.attendance_events e
           where e.user_id = c.user_id and e.attendance_day = c.attendance_day and e.event_type = 'CLOCK_OUT')
  from claimed c
  join app.users u on u.id = c.user_id
  order by c.attendance_day, clock_in;
end;
$$;

-- Report the outcome for a claimed version. Success only counts if no newer event arrived.
create function app.complete_sheet_sync(p_day date, p_user_id uuid, p_version integer, p_error text)
returns void
language sql volatile security definer set search_path = pg_catalog, pg_temp as $$
  update app.sheet_sync set
    synced_version = case when p_error is null then greatest(synced_version, p_version) else synced_version end,
    last_error = case when p_error is null then null else left(p_error, 500) end,
    last_synced_at = case when p_error is null then now() else last_synced_at end,
    claimed_until = null
  where attendance_day = p_day and user_id = p_user_id;
$$;

-- Admin-only status for the Settings page.
create function app.sheet_sync_status(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return (
    select jsonb_build_object(
      'ok', true,
      'pending', count(*) filter (where synced_version < version),
      'failing', count(*) filter (where synced_version < version and last_error is not null),
      'last_error', (select last_error from app.sheet_sync where last_error is not null
                     order by updated_at desc limit 1),
      'last_synced_at', max(last_synced_at)
    )
    from app.sheet_sync
  );
end;
$$;

revoke execute on all functions in schema app from public;
grant execute on function
  app.sheet_sync_target(),
  app.claim_sheet_sync(integer, integer),
  app.complete_sheet_sync(date, uuid, integer, text),
  app.sheet_sync_status(uuid)
to attendance_app;
