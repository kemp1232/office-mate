-- Least-privilege runtime role, locked-down Data API roles, and the org-domain constraint.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- attendance_app cannot touch attendance tables directly — only via vetted functions.
select ok(not has_table_privilege('attendance_app', 'app.attendance_events', 'INSERT'), 'app role cannot INSERT events directly');
select ok(not has_table_privilege('attendance_app', 'app.attendance_events', 'UPDATE'), 'app role cannot UPDATE events');
select ok(not has_table_privilege('attendance_app', 'app.attendance_events', 'DELETE'), 'app role cannot DELETE events');
select ok(not has_table_privilege('attendance_app', 'app.attendance_events', 'SELECT'), 'app role cannot SELECT events directly');
select ok(not has_table_privilege('attendance_app', 'app.attendance_settings', 'UPDATE'), 'app role cannot UPDATE settings directly');
select ok(has_function_privilege('attendance_app', 'app.record_attendance(uuid, double precision, double precision, double precision, text, text, text)', 'EXECUTE'), 'app role can execute record_attendance');
select ok(not has_function_privilege('attendance_app', 'app.team_member_email(uuid)', 'EXECUTE'), 'internal helpers are not executable by the app role');
select ok(not has_function_privilege('attendance_app', 'app.attendance_day(timestamptz, text)', 'EXECUTE'), 'attendance_day helper is internal');

-- Supabase Data API roles have no access to the private schema at all.
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'anon has no usage on app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'authenticated has no usage on app schema');
select ok(not has_function_privilege('anon', 'app.record_attendance(uuid, double precision, double precision, double precision, text, text, text)', 'EXECUTE'), 'anon cannot execute record_attendance');
select ok(not has_function_privilege('authenticated', 'app.update_admin_settings(uuid, double precision, double precision, integer, integer, text)', 'EXECUTE'), 'authenticated cannot execute update_admin_settings');

-- Only organisation accounts can exist.
select throws_ok(
  $$insert into app.users (name, email, email_verified, updated_at) values ('X', 'jane@gmail.com', true, now())$$,
  '23514', null, 'non-firstmate.tech email is rejected by the database');
select throws_ok(
  $$insert into app.users (name, email, email_verified, updated_at) values ('X', 'jane@firstmate.tech.evil.com', true, now())$$,
  '23514', null, 'look-alike domain is rejected');
select throws_ok(
  $$insert into app.users (name, email, email_verified, updated_at) values ('X', 'Jane@FirstMate.tech', true, now())$$,
  '23514', null, 'non-normalised (uppercase) email is rejected');
select lives_ok(
  $$insert into app.users (name, email, email_verified, updated_at) values ('X', 'jane.privtest@firstmate.tech', true, now())$$,
  'org email is accepted');
select throws_ok(
  $$insert into app.users (name, email, email_verified, updated_at) values ('X', 'jane+alt@firstmate.tech', true, now())$$,
  '23514', null, 'plus-addressed aliases are rejected (one identity per mailbox)');

-- Every app function pins search_path with pg_temp LAST (blocks temp-schema type/function shadowing).
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and not coalesce('search_path=pg_catalog, pg_temp' = any (p.proconfig), false)),
  0::bigint, 'all app.* functions use search_path = pg_catalog, pg_temp');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'postgres'),
  0::bigint, 'security definer functions are owned by postgres (not the runtime role)');

select * from finish();
rollback;
