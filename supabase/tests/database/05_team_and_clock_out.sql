-- Team management: names, the prefilled list, Admin member CRUD, Clock Out rules + today-only
-- overrides (gate + record_attendance), deactivation, and privileges.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

-- Fixtures -----------------------------------------------------------------------
update app.attendance_settings set office_latitude = 14.5547, office_longitude = 121.0244,
  radius_m = 300, accuracy_threshold_m = 50;
insert into app.users (name, email, email_verified, updated_at)
values ('Admin', 'admin@firstmate.tech', true, now())
on conflict (email) do update set email_verified = true;
insert into app.users (id, first_name, last_name, name, email, email_verified, updated_at) values
  ('00000000-0000-0000-0000-0000000005a1', 'Hours', 'Member', '', 'hours.t5@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-0000000005a2', 'Locked', 'Member', '', 'locked.t5@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-0000000005a3', 'Leaver', 'Member', '', 'leaver.t5@firstmate.tech', true, now()),
  ('00000000-0000-0000-0000-0000000005a4', 'Gate', 'Member', '', 'gate.t5@firstmate.tech', true, now());
create function pg_temp.admin_id() returns uuid language sql as $$
  select id from app.users where email = 'admin@firstmate.tech' $$;
create function pg_temp.member(n int) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-0000000005a' || n)::uuid $$;
create function pg_temp.save(p_member uuid, p_first text, p_last text, p_email text,
  p_mode text default 'NONE', p_time time default null, p_minutes int default null, p_as uuid default null)
  returns jsonb language sql as $$
    select app.admin_save_member(coalesce(p_as, pg_temp.admin_id()), p_member, p_first, p_last, p_email,
                                 p_mode, p_time, p_minutes) $$;
create function pg_temp.rec(uid uuid, expected text) returns jsonb language sql as $$
  select app.record_attendance(uid, 14.5547, 121.0244, 10, 'DIRECT', expected, 'Asia/Manila') $$;
create function pg_temp.events(uid uuid) returns bigint language sql as $$
  select count(*) from app.attendance_events where user_id = uid $$;
create function pg_temp.gate(uid uuid, clock_in timestamptz, at timestamptz) returns jsonb language sql as $$
  select app.clock_out_gate(uid, '2026-10-01', 'Asia/Manila', clock_in, at) $$;

-- Names --------------------------------------------------------------------------
select is((select name from app.users where id = pg_temp.member(1)), 'Hours Member', 'name is derived from first + last');
insert into app.users (name, email, email_verified, updated_at) values ('  Juan   Dela  Cruz ', 'juan.t5@firstmate.tech', true, now());
select is((select first_name || '|' || last_name from app.users where email = 'juan.t5@firstmate.tech'), 'Juan Dela|Cruz',
  'a row written with only a full name is split (last word = last name)');
update app.users set first_name = 'Hourly' where id = pg_temp.member(1);
select is((select name from app.users where id = pg_temp.member(1)), 'Hourly Member', 'editing a first name updates the full name');
select is((select count(*) from app.users where email in ('aemielvinloremia@firstmate.tech', 'kempsayson@firstmate.tech',
  'sethpalileo@firstmate.tech', 'edhiramis@firstmate.tech') and email_verified), 4::bigint, 'the team list is prefilled');
select is((select first_name || '|' || last_name from app.users where email = 'jakezozobrado@firstmate.tech'), 'Jake|Zozobrado',
  'prefilled names are trimmed');

-- Privileges ---------------------------------------------------------------------
select ok(not has_table_privilege('attendance_app', 'app.clock_out_rules', 'SELECT'), 'app role cannot read rules directly');
select ok(not has_table_privilege('attendance_app', 'app.clock_out_overrides', 'INSERT'), 'app role cannot write overrides directly');
select ok(has_function_privilege('attendance_app', 'app.admin_save_member(uuid, uuid, text, text, text, text, time, integer)', 'EXECUTE'),
  'app role can execute admin_save_member');
select ok(not has_function_privilege('attendance_app', 'app.clock_out_gate(uuid, date, text, timestamptz, timestamptz)', 'EXECUTE'),
  'the gate helper is internal');
select ok(not has_function_privilege('authenticated', 'app.admin_set_member_active(uuid, uuid, boolean)', 'EXECUTE'),
  'Data API roles cannot deactivate members');

-- admin_save_member ----------------------------------------------------------------
select is(pg_temp.save(null, 'X', '', 'x.t5@firstmate.tech', p_as => pg_temp.member(1))->>'code', 'FORBIDDEN',
  'a Team Member cannot add members');
select ok((pg_temp.save(null, ' Nieves ', 'New', 'NEW.T5@firstmate.tech')->>'ok')::boolean, 'the Admin adds a member');
select is((select first_name || '|' || name || '|' || email_verified from app.users where email = 'new.t5@firstmate.tech'),
  'Nieves|Nieves New|true', 'added members are stored normalised and Admin-verified');
select is(pg_temp.save(null, 'Dup', '', 'new.t5@firstmate.tech')->>'code', 'EMAIL_TAKEN', 'emails are unique');
select is(pg_temp.save(null, 'X', '', 'x@gmail.com')->>'field', 'email', 'only @firstmate.tech emails');
select is(pg_temp.save(null, 'X', '', 'admin@firstmate.tech')->>'field', 'email', 'the Admin account cannot be added as a member');
select is(pg_temp.save(null, '  ', '', 'blank.t5@firstmate.tech')->>'field', 'firstName', 'a first name is required');
select is(pg_temp.save(null, 'X', '', 'short.t5@firstmate.tech', 'HOURS', null, 20)->>'field', 'requiredHours',
  'required hours are at least 30 minutes');
select is(pg_temp.save(null, 'X', '', 'notime.t5@firstmate.tech', 'TIME')->>'field', 'clockOutTime', 'a fixed rule needs a time');
select is(pg_temp.save(pg_temp.admin_id(), 'Admin', '', 'admin@firstmate.tech')->>'code', 'INVALID_INPUT',
  'the Admin account cannot be edited here');

select ok((pg_temp.save(pg_temp.member(3), 'Leaver', 'Member', 'leaver2.t5@firstmate.tech')->>'ok')::boolean,
  'the email can change before their first sign in');
insert into app.accounts (account_id, provider_id, user_id, updated_at)
values ('google-sub-t5', 'google', pg_temp.member(3), now());
select is(pg_temp.save(pg_temp.member(3), 'Leaver', 'Member', 'leaver3.t5@firstmate.tech')->>'code', 'EMAIL_LOCKED',
  'after their first sign in the email is fixed');
select ok((pg_temp.save(pg_temp.member(3), 'Lea', 'Ver', 'leaver2.t5@firstmate.tech')->>'ok')::boolean,
  '…but their names can still be edited');

select ok((pg_temp.save(pg_temp.member(1), 'Hourly', 'Member', 'hours.t5@firstmate.tech', 'HOURS', null, 60)->>'ok')::boolean,
  'a required-hours rule is saved');
select is((select required_minutes from app.clock_out_rules where user_id = pg_temp.member(1)), 60, 'rule stored in minutes');
select ok((pg_temp.save(pg_temp.member(4), 'Gate', 'Member', 'gate.t5@firstmate.tech', 'TIME', '18:00')->>'ok')::boolean,
  'a fixed-time rule is saved');
select is(pg_temp.save(pg_temp.member(4), 'Gate', 'Member', 'gate.t5@firstmate.tech', 'TIME', '18:00:30')->>'field', 'clockOutTime',
  'fixed times are whole minutes');

-- The gate at exact times (2026-10-01, Asia/Manila = UTC+8) ------------------------------
select is(pg_temp.gate(pg_temp.member(4), '2026-10-01 09:00+08', '2026-10-01 17:59+08')->>'status', 'NOT_YET',
  'fixed time: 17:59 is too early for 18:00');
select is((pg_temp.gate(pg_temp.member(4), '2026-10-01 09:00+08', '2026-10-01 17:59+08')->>'opens_at')::timestamptz,
  '2026-10-01 18:00+08'::timestamptz, 'fixed time opens at 18:00 office time');
select is(pg_temp.gate(pg_temp.member(4), '2026-10-01 09:00+08', '2026-10-01 18:00+08')->>'status', 'OPEN',
  'fixed time: open from 18:00');
select is(pg_temp.gate(pg_temp.member(4), '2026-10-01 19:30+08', '2026-10-01 19:31+08')->>'status', 'OPEN',
  'clocking in after the fixed time: Clock Out is open right away');
select is(pg_temp.gate(pg_temp.member(1), '2026-10-01 09:00+08', '2026-10-01 09:59+08')->>'status', 'NOT_YET',
  'required hours: 59 minutes after Clock In is too early for 1 hour');
select is(pg_temp.gate(pg_temp.member(1), '2026-10-01 09:00+08', '2026-10-01 10:00+08')->>'status', 'OPEN',
  'required hours: open exactly 1 hour after Clock In');
select is(pg_temp.gate(pg_temp.member(2), null, '2026-10-01 07:00+08')->>'status', 'OPEN', 'no rule: always open');
select is(pg_temp.gate(pg_temp.member(4), null, '2026-10-01 07:00+08')->'rule'->>'clock_out_time', '18:00',
  'the gate reports the rule');

insert into app.clock_out_overrides (user_id, attendance_day, state) values
  (pg_temp.member(4), '2026-10-01', 'UNLOCKED'),
  (pg_temp.member(2), '2026-09-30', 'LOCKED');
select is(pg_temp.gate(pg_temp.member(4), '2026-10-01 09:00+08', '2026-10-01 12:00+08')->>'status', 'OPEN',
  'an unlock opens Clock Out before the rule');
update app.clock_out_overrides set state = 'LOCKED' where user_id = pg_temp.member(4);
select is(pg_temp.gate(pg_temp.member(4), '2026-10-01 09:00+08', '2026-10-01 20:00+08')->>'status', 'LOCKED',
  'a lock closes Clock Out even after the rule opens it');
select is(pg_temp.gate(pg_temp.member(2), null, '2026-10-01 20:00+08')->>'status', 'OPEN',
  'yesterday''s lock does not carry over to today');

-- record_attendance enforces the gate --------------------------------------------------
select ok((pg_temp.rec(pg_temp.member(1), 'CLOCK_IN')->>'ok')::boolean, 'a member with a 1-hour rule clocks in');
select is(app.get_attendance_state(pg_temp.member(1), 'Asia/Manila')->'clock_out'->>'status', 'NOT_YET',
  'their state says Clock Out is not open yet');
select is(pg_temp.rec(pg_temp.member(1), 'CLOCK_OUT')->>'code', 'CLOCK_OUT_TOO_EARLY', 'an early Clock Out is refused');
select ok(pg_temp.rec(pg_temp.member(1), 'CLOCK_OUT')->>'opens_at' is not null, '…with the time it opens');
select is(pg_temp.events(pg_temp.member(1)), 1::bigint, '…and nothing is written');

select is(app.admin_set_clock_out_override(pg_temp.member(2), pg_temp.member(1), 'UNLOCKED', 'Asia/Manila')->>'code', 'FORBIDDEN',
  'a Team Member cannot unlock anyone');
select is(app.admin_set_clock_out_override(pg_temp.admin_id(), pg_temp.member(1), 'OPEN', 'Asia/Manila')->>'code', 'INVALID_INPUT',
  'override must be LOCKED, UNLOCKED or FOLLOW_RULE');
select is(app.admin_set_clock_out_override(pg_temp.admin_id(), pg_temp.admin_id(), 'LOCKED', 'Asia/Manila')->>'code', 'NOT_FOUND',
  'the Admin account has no Clock Out to lock');
select ok((app.admin_set_clock_out_override(pg_temp.admin_id(), pg_temp.member(1), 'UNLOCKED', 'Asia/Manila')->>'ok')::boolean,
  'the Admin unlocks Clock Out for today');
select ok((pg_temp.rec(pg_temp.member(1), 'CLOCK_OUT')->>'ok')::boolean, 'an unlocked member clocks out before their rule');

select ok((pg_temp.rec(pg_temp.member(2), 'CLOCK_IN')->>'ok')::boolean, 'a member without a rule clocks in');
select ok((app.admin_set_clock_out_override(pg_temp.admin_id(), pg_temp.member(2), 'LOCKED', 'Asia/Manila')->>'ok')::boolean,
  'the Admin locks their Clock Out for today');
select is(pg_temp.rec(pg_temp.member(2), 'CLOCK_OUT')->>'code', 'CLOCK_OUT_LOCKED', 'a locked Clock Out is refused');
select is(pg_temp.rec(pg_temp.member(2), 'CLOCK_OUT')->'state'->'clock_out'->>'status', 'LOCKED', '…and the state says why');
select ok((app.admin_set_clock_out_override(pg_temp.admin_id(), pg_temp.member(2), 'FOLLOW_RULE', 'Asia/Manila')->>'ok')::boolean,
  'the Admin removes the lock');
select ok((pg_temp.rec(pg_temp.member(2), 'CLOCK_OUT')->>'ok')::boolean, 'they can clock out again');

-- Deactivation -----------------------------------------------------------------------
insert into app.sessions (expires_at, token, updated_at, user_id)
values (now() + interval '1 day', 'session-t5', now(), pg_temp.member(3));
select is(app.admin_set_member_active(pg_temp.member(1), pg_temp.member(3), false)->>'code', 'FORBIDDEN',
  'a Team Member cannot deactivate anyone');
select ok((app.admin_set_member_active(pg_temp.admin_id(), pg_temp.member(3), false)->>'ok')::boolean, 'the Admin deactivates a member');
select is((select count(*) from app.sessions where user_id = pg_temp.member(3)), 0::bigint, 'deactivating signs them out everywhere');
select is(app.get_attendance_state(pg_temp.member(3), 'Asia/Manila')->>'code', 'FORBIDDEN', 'a deactivated member has no attendance');
select is(pg_temp.rec(pg_temp.member(3), 'CLOCK_IN')->>'code', 'FORBIDDEN', 'a deactivated member cannot clock in');
select is(app.admin_set_member_active(pg_temp.admin_id(), pg_temp.admin_id(), false)->>'code', 'NOT_FOUND',
  'the Admin account cannot be deactivated');
select ok((app.admin_set_member_active(pg_temp.admin_id(), pg_temp.member(3), true)->>'ok')::boolean, 'the Admin reactivates them');
select is(app.get_attendance_state(pg_temp.member(3), 'Asia/Manila')->>'ok', 'true', 'reactivating restores access');

-- Team list ----------------------------------------------------------------------------
select is(app.admin_team(pg_temp.member(1), 'Asia/Manila')->>'code', 'FORBIDDEN', 'only the Admin sees the team');
select is((select count(*) from jsonb_array_elements(app.admin_team(pg_temp.admin_id(), 'Asia/Manila')->'members') m
           where m->>'email' = 'admin@firstmate.tech'), 0::bigint, 'the Admin account is not in the team list');
select is((select string_agg(m->>'signed_in', ',' order by m->>'email')
           from jsonb_array_elements(app.admin_team(pg_temp.admin_id(), 'Asia/Manila')->'members') m
           where m->>'email' in ('hours.t5@firstmate.tech', 'leaver2.t5@firstmate.tech')),
  'false,true', 'the list shows who has signed in');

select * from finish();
rollback;
