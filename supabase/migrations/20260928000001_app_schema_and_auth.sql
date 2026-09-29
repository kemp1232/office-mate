-- =====================================================================================
-- App schema, least-privilege runtime role, and Better Auth tables.
--
-- Everything lives in the private `app` schema, which is NOT exposed through the Supabase
-- Data API. The Next.js server connects as `attendance_app` (see docs/deployment.md):
--   * full CRUD on the Better Auth tables (it *is* the auth server)
--   * NO table privileges on attendance tables — only EXECUTE on vetted functions
-- Better Auth is configured with snake_case field mappings + uuid ids (src/lib/auth-config.ts).
-- =====================================================================================

create schema if not exists app;
revoke all on schema app from public;

-- Runtime role. Created without LOGIN; a password is set out-of-band per environment
-- (never committed): `alter role attendance_app with login password '…';`
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'attendance_app') then
    create role attendance_app nologin noinherit;
  end if;
end
$$;

grant usage on schema app to attendance_app;
-- Lets migrations/tests run as `postgres` impersonate the runtime role (SET ROLE) without
-- inheriting its privileges.
grant attendance_app to postgres with inherit false, set true;
alter role attendance_app set search_path = app;

-- ---------------------------------------------------------------------------------
-- Better Auth core tables (better-auth 1.7.x)
-- ---------------------------------------------------------------------------------
create table app.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  -- Only organisation accounts can exist at all (sign-up is also filtered in the app).
  constraint users_email_org_domain check (email = lower(email) and email ~ '^[^@\s+]+@firstmate\.tech$')
);

create table app.sessions (
  id uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id uuid not null references app.users (id) on delete cascade
);
create index sessions_user_id_idx on app.sessions (user_id);

create table app.accounts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references app.users (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null
);
create index accounts_user_id_idx on app.accounts (user_id);

create table app.verifications (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);
create index verifications_identifier_idx on app.verifications (identifier);

-- Database-backed rate limiting (in-memory limits don't work on serverless).
create table app.rate_limits (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  count integer not null,
  last_request bigint not null
);

alter table app.users enable row level security;
alter table app.sessions enable row level security;
alter table app.accounts enable row level security;
alter table app.verifications enable row level security;
alter table app.rate_limits enable row level security;

-- The runtime role owns no tables, so RLS would block it; it is the auth server for these
-- tables and gets explicit, policy-backed access.
grant select, insert, update, delete on
  app.users, app.sessions, app.accounts, app.verifications, app.rate_limits
to attendance_app;

create policy auth_server_all on app.users for all to attendance_app using (true) with check (true);
create policy auth_server_all on app.sessions for all to attendance_app using (true) with check (true);
create policy auth_server_all on app.accounts for all to attendance_app using (true) with check (true);
create policy auth_server_all on app.verifications for all to attendance_app using (true) with check (true);
create policy auth_server_all on app.rate_limits for all to attendance_app using (true) with check (true);
