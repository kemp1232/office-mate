-- Distance calculation and the organisation-timezone attendance day.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Distance: same point, 1° of latitude, known city pair.
select is(app.distance_m(14.5547, 121.0244, 14.5547, 121.0244), 0::double precision, 'distance to self is 0');
select ok(abs(app.distance_m(0, 0, 1, 0) - 111195.08) < 1, '1 degree of latitude ≈ 111,195 m');
-- Makati CBD (Ayala Triangle) → Manila City Hall ≈ 7.0 km
select ok(app.distance_m(14.5566, 121.0233, 14.5896, 120.9817) between 5500 and 6000, 'Makati → Manila City Hall ≈ 5.7 km');
select ok(abs(app.distance_m(0, 179.9995, 0, -179.9995) - 111.19) < 1, 'antimeridian is handled (≈111 m)');
-- ~300 m north of an office: 300 / 111195.08 degrees latitude
select ok(abs(app.distance_m(14.5547, 121.0244, 14.5547 + 300 / 111195.08, 121.0244) - 300) < 0.5, '≈300 m offset measures ≈300 m');

-- Attendance day uses the org timezone, not UTC.
select is(app.attendance_day('2026-09-28 15:59:59+00', 'Asia/Manila'), '2026-09-28'::date, '23:59:59 Manila is still Sep 28');
select is(app.attendance_day('2026-09-28 16:00:00+00', 'Asia/Manila'), '2026-09-29'::date, '00:00 Manila (16:00 UTC) is Sep 29');
select isnt(app.attendance_day('2026-09-28 17:00:00+00', 'Asia/Manila'), ('2026-09-28 17:00:00+00'::timestamptz at time zone 'UTC')::date, 'business date differs from the UTC date after Manila midnight');
select is(app.attendance_day('2026-09-28 17:00:00+00', 'UTC'), '2026-09-28'::date, 'timezone is configurable (UTC gives UTC date)');
select throws_ok($$select app.attendance_day(now(), 'Mars/Olympus')$$, '22023', null, 'unknown timezone is rejected');
select throws_ok($$select app.attendance_day(now(), null)$$, '22023', null, 'missing timezone is rejected');

-- Finite checks used for input validation.
select ok(not app.is_finite('NaN'::double precision) and not app.is_finite('Infinity'::double precision) and app.is_finite(1.5), 'is_finite rejects NaN/Infinity');

select * from finish();
rollback;
