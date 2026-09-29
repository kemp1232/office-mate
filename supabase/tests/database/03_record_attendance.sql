-- State machine, validation order, geofence boundaries, snapshots and attendance-day rules
-- for app.record_attendance / app.get_attendance_state.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Fixtures -----------------------------------------------------------------------
insert into app.users (id, name, email, email_verified, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', 'Member', 'member.t3@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-00000000000b', 'Unverified', 'unverified.t3@firstmate.tech', false, now()),
  ('00000000-0000-0000-0000-00000000000c', 'Yesterday', 'yesterday.t3@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-00000000000d', 'Other', 'other.t3@firstmate.tech', true, now());

create temp table t (k text primary key, v double precision);
insert into t values
  ('olat', 14.5547), ('olng', 121.0244),
  ('in_lat', 14.5547 + 299.5 / 111195.08),   -- 299.5 m north
  ('out_lat', 14.5547 + 300.5 / 111195.08),  -- 300.5 m north
  ('far_lat', 14.6500);                       -- ~10 km away
create function pg_temp.v(key text) returns double precision language sql as $$ select v from t where k = key $$;
create function pg_temp.rec(uid text, lat double precision, acc double precision, expected text, src text default 'DIRECT')
  returns jsonb language sql as $$
    select app.record_attendance(uid::uuid, lat, pg_temp.v('olng'), acc, src, expected, 'Asia/Manila')
  $$;
create function pg_temp.events(uid text) returns bigint language sql as $$
  select count(*) from app.attendance_events where user_id = uid::uuid $$;

-- Unconfigured -------------------------------------------------------------------
update app.attendance_settings set office_latitude = null, office_longitude = null, radius_m = 300, accuracy_threshold_m = 50;
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000a', 'Asia/Manila')->>'configured', 'false', 'office starts unconfigured');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->>'code', 'NOT_CONFIGURED', 'attendance unavailable until an office is set');

update app.attendance_settings set office_latitude = pg_temp.v('olat'), office_longitude = pg_temp.v('olng');
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000a', 'Asia/Manila')->>'configured', 'true', 'configured once office is set');

-- Identity -------------------------------------------------------------------------
select is(app.record_attendance(null, 14.5, 121.0, 10, 'DIRECT', 'CLOCK_IN', 'Asia/Manila')->>'code', 'UNAUTHENTICATED', 'no user → UNAUTHENTICATED');
select is(pg_temp.rec('00000000-0000-0000-0000-0000000000ff', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->>'code', 'FORBIDDEN', 'unknown user → FORBIDDEN');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000b', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->>'code', 'FORBIDDEN', 'unverified email → FORBIDDEN');
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000b', 'Asia/Manila')->>'code', 'FORBIDDEN', 'unverified user cannot read state');

-- State A: no clock in -------------------------------------------------------------
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000a', 'Asia/Manila')->>'next_action', 'CLOCK_IN', 'no events → next action CLOCK_IN');

-- Input validation -------------------------------------------------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', 'NaN', 10, 'CLOCK_IN')->>'code', 'INVALID_INPUT', 'NaN latitude rejected');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', 91, 10, 'CLOCK_IN')->>'code', 'INVALID_INPUT', 'latitude > 90 rejected');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 0, 'CLOCK_IN')->>'code', 'INVALID_INPUT', 'zero accuracy rejected');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 'Infinity', 'CLOCK_IN')->>'code', 'INVALID_INPUT', 'infinite accuracy rejected');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'CLOCK_IN', 'NFC')->>'code', 'INVALID_INPUT', 'unknown source rejected');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'DAY_COMPLETE')->>'code', 'INVALID_INPUT', 'expected action must be CLOCK_IN or CLOCK_OUT');

-- Accuracy is checked BEFORE the radius ----------------------------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('far_lat'), 50.5, 'CLOCK_IN')->>'code', 'ACCURACY_TOO_LOW', 'poor accuracy wins even when far outside');
select is((pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 51, 'CLOCK_IN')->>'accuracy_threshold_m')::int, 50, 'accuracy rejection reports threshold');

-- Radius ---------------------------------------------------------------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('out_lat'), 10, 'CLOCK_IN')->>'code', 'OUTSIDE_GEOFENCE', '300.5 m is outside a 300 m radius');
select is((pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('far_lat'), 10, 'CLOCK_IN')->>'radius_m')::int, 300, 'outside rejection reports radius');

-- Precondition: the browser can't pick the event type -----------------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'CLOCK_OUT')->>'code', 'STATE_CHANGED', 'cannot Clock Out before Clock In (server derives the action)');
select is(pg_temp.events('00000000-0000-0000-0000-00000000000a'), 0::bigint, 'no rows written by any rejected attempt');

-- Clock In (boundary: 299.5 m, accuracy exactly at threshold) ----------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 50, 'CLOCK_IN', 'QR')->'event'->>'event_type', 'CLOCK_IN', 'inside radius with accuracy == threshold records CLOCK_IN');
select results_eq(
  $$select event_type::text, source::text, recorded_at between now() and clock_timestamp(), attendance_day = app.attendance_day(now(), 'Asia/Manila'),
           email, radius_m, accuracy_threshold_m, office_latitude, round(distance_m)::int, geofence_result
    from app.attendance_events where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$values ('CLOCK_IN', 'QR', true, true, 'member.t3@firstmate.tech', 300, 50, 14.5547::double precision, 300, 'PASS')$$,
  'event stores DB clock timestamp, org-day, email snapshot, settings snapshot and distance');

-- State B: clocked in ----------------------------------------------------------------------
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000a', 'Asia/Manila')->>'next_action', 'CLOCK_OUT', 'clock in only → next action CLOCK_OUT');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->>'code', 'STATE_CHANGED', 'retried Clock In does not become a Clock Out');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->'state'->>'next_action', 'CLOCK_OUT', 'STATE_CHANGED returns the real state');
select is(pg_temp.events('00000000-0000-0000-0000-00000000000a'), 1::bigint, 'duplicate Clock In prevented');

-- Evidence snapshot survives later settings changes ----------------------------------------
update app.attendance_settings set radius_m = 500;
select is((select radius_m from app.attendance_events where user_id = '00000000-0000-0000-0000-00000000000a'), 300, 'stored event keeps the radius it was validated with');

-- Clock Out → State C ------------------------------------------------------------------------
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 12, 'CLOCK_OUT')->'event'->>'event_type', 'CLOCK_OUT', 'Clock Out recorded');
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000a', 'Asia/Manila')->>'next_action', 'DAY_COMPLETE', 'clock in + out → DAY_COMPLETE');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 12, 'CLOCK_OUT')->>'code', 'STATE_CHANGED', 'duplicate Clock Out prevented');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000a', pg_temp.v('in_lat'), 12, 'CLOCK_IN')->>'code', 'STATE_CHANGED', 'no third action after day complete');
select is(pg_temp.events('00000000-0000-0000-0000-00000000000a'), 2::bigint, 'exactly two events for the day');

-- Database constraints as a backstop -------------------------------------------------------
select throws_ok(
  $$insert into app.attendance_events (user_id, email, event_type, attendance_day, latitude, longitude, accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
    values ('00000000-0000-0000-0000-00000000000a', 'member.t3@firstmate.tech', 'CLOCK_IN', app.attendance_day(now(), 'Asia/Manila'), 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50)$$,
  '23505', null, 'unique constraint blocks a second Clock In even on direct insert');
select throws_ok(
  $$insert into app.attendance_events (user_id, email, event_type, attendance_day, latitude, longitude, accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
    values ('00000000-0000-0000-0000-00000000000d', 'other.t3@firstmate.tech', 'CLOCK_OUT', current_date, 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50)$$,
  '23514', null, 'Clock Out without Clock In is impossible even on direct insert');
select throws_ok(
  $$insert into app.attendance_events (user_id, email, event_type, attendance_day, latitude, longitude, accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
    values ('00000000-0000-0000-0000-00000000000d', 'other.t3@firstmate.tech', 'CLOCK_IN', current_date, 14.5547, 121.0244, 80, 0, 14.5547, 121.0244, 300, 50)$$,
  '23514', null, 'a record can never claim a failed validation');

-- Previous incomplete day ---------------------------------------------------------------------
insert into app.attendance_events (user_id, email, event_type, attendance_day, recorded_at, latitude, longitude, accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
values ('00000000-0000-0000-0000-00000000000c', 'yesterday.t3@firstmate.tech', 'CLOCK_IN',
        app.attendance_day(now(), 'Asia/Manila') - 1, now() - interval '1 day', 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50);
select is(app.get_attendance_state('00000000-0000-0000-0000-00000000000c', 'Asia/Manila')->>'next_action', 'CLOCK_IN', 'forgotten Clock Out yesterday does not block today''s Clock In');
select is(pg_temp.rec('00000000-0000-0000-0000-00000000000c', pg_temp.v('in_lat'), 10, 'CLOCK_IN')->>'ok', 'true', 'today''s Clock In succeeds');
select is(
  (select count(*) from app.attendance_events where user_id = '00000000-0000-0000-0000-00000000000c' and attendance_day = app.attendance_day(now(), 'Asia/Manila') - 1),
  1::bigint, 'yesterday is left untouched (no automatic Clock Out)');

-- Runs as the least-privilege runtime role ---------------------------------------------------
create temp table as_app (j jsonb);
grant insert, select on as_app to attendance_app;
set local role attendance_app;
insert into as_app select app.record_attendance('00000000-0000-0000-0000-00000000000d'::uuid, (select 14.5547 + 10 / 111195.08), 121.0244, 8, 'DIRECT', 'CLOCK_IN', 'Asia/Manila');
reset role;
select is((select j->>'ok' from as_app), 'true', 'attendance_app can record via the function');
select is((select j->'state'->>'timezone' from as_app), 'Asia/Manila', 'state reports the org timezone');
select ok((select (j->'event'->>'distance_m')::numeric = 10 from as_app), 'returned distance is server-calculated (10 m)');

select * from finish();
rollback;
