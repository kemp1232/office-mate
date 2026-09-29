-- Attendance records are write-once for EVERY role; Admin-only settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into app.users (id, name, email, email_verified, updated_at) values
  ('00000000-0000-0000-0000-0000000004a1', 'Admin', 'admin@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-0000000004b1', 'Member', 'member.t4@firstmate.tech', true, now())
on conflict (email) do nothing;

-- Use whichever admin row exists (a local dev DB may already have one).
create temp table ids as
  select (select id from app.users where email = 'admin@firstmate.tech') as admin_id,
         '00000000-0000-0000-0000-0000000004b1'::uuid as member_id;
update app.users set email_verified = true where email = 'admin@firstmate.tech';

update app.attendance_settings set office_latitude = 14.5547, office_longitude = 121.0244, radius_m = 300, accuracy_threshold_m = 50;
select ok((app.record_attendance((select member_id from ids), 14.5547, 121.0244, 5, 'DIRECT', 'CLOCK_IN', 'Asia/Manila')->>'ok')::boolean, 'fixture event recorded');

-- Immutability (even the table owner / superuser path is blocked by triggers) ---------------
select throws_ok($$update app.attendance_events set recorded_at = now() - interval '1 hour'$$, '42501', null, 'UPDATE is blocked');
select throws_ok($$update app.attendance_events set event_type = 'CLOCK_OUT'$$, '42501', null, 'changing event type is blocked');
select throws_ok($$delete from app.attendance_events$$, '42501', null, 'DELETE is blocked');
select throws_ok($$truncate app.attendance_events$$, '42501', null, 'TRUNCATE is blocked');
select throws_ok($$delete from app.users where id = (select member_id from ids)$$, '23503', null, 'a user with attendance history cannot be deleted');

-- (test-only, rolled back) let the runtime role see pgTAP's assertion functions
grant usage on schema extensions to attendance_app;
set local role attendance_app;
select throws_ok($$update app.attendance_events set latitude = 0$$, '42501', null, 'app role cannot UPDATE events');
select throws_ok($$delete from app.attendance_events$$, '42501', null, 'app role cannot DELETE events');
select throws_ok($$update app.attendance_settings set radius_m = 1$$, '42501', null, 'app role cannot bypass the settings function');
reset role;

-- Settings: Admin only ----------------------------------------------------------------------
select is(app.get_admin_settings((select member_id from ids))->>'code', 'FORBIDDEN', 'Team Member cannot read Admin settings');
select is(
  app.update_admin_settings((select member_id from ids), 1, 1, 10, 10, 'https://example.com')->>'code',
  'FORBIDDEN', 'Team Member cannot change settings');
select is((select radius_m from app.attendance_settings), 300, 'settings unchanged after a forbidden attempt');

select is(
  (app.update_admin_settings((select admin_id from ids), 14.6, 121.1, 250, 40, 'https://docs.google.com/spreadsheets/d/x')->>'radius_m')::int,
  250, 'Admin can set location, radius, accuracy and report link');
select results_eq(
  $$select office_latitude, office_longitude, accuracy_threshold_m, report_url, updated_by from app.attendance_settings$$,
  $$select 14.6::double precision, 121.1::double precision, 40, 'https://docs.google.com/spreadsheets/d/x'::text, (select admin_id from ids)$$,
  'settings persisted with updated_by');
select is(app.update_admin_settings((select admin_id from ids), 14.6, 121.1, 1, 40, 'https://x.test')->>'code', 'INVALID_INPUT', 'radius below 10 m rejected');
select is(app.update_admin_settings((select admin_id from ids), 14.6, 121.1, 300, 50, 'javascript:alert(1)')->>'code', 'INVALID_INPUT', 'non-https report link rejected');
select throws_ok($$delete from app.attendance_settings$$, '42501', null, 'the settings row cannot be deleted');

select * from finish();
rollback;
