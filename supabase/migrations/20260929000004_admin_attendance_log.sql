-- =====================================================================================
-- Admin attendance log (read-only) + the Admin no longer clocks in/out.
-- =====================================================================================

-- Team Members are verified org accounts that are NOT on the Admin allow-list. The Admin account
-- has no attendance screen, and record_attendance / get_attendance_state refuse it (FORBIDDEN).
create or replace function app.team_member_email(p_user_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select u.email from app.users u
  where u.id = p_user_id
    and u.email_verified
    and split_part(u.email, '@', 2) = 'firstmate.tech'
    and u.email <> all (app.admin_emails());
$$;

-- Office days = attendance days with at least one event, newest first. Admin only.
create function app.admin_office_days(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return jsonb_build_object(
    'ok', true,
    'days', coalesce(
      (select jsonb_agg(d order by d desc) from (select distinct attendance_day as d from app.attendance_events) x),
      '[]'::jsonb)
  );
end;
$$;

-- One row per person for an office day: name, email, clock in, clock out. Admin only.
create function app.admin_day_attendance(p_user_id uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not app.is_admin(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return jsonb_build_object(
    'ok', true,
    'day', p_day,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', u.name,
               'email', x.email,
               'clock_in_at', x.clock_in,
               'clock_out_at', x.clock_out)
             order by x.clock_in nulls last, x.email)
      from (
        select e.user_id,
               max(e.email) as email,
               max(e.recorded_at) filter (where e.event_type = 'CLOCK_IN') as clock_in,
               max(e.recorded_at) filter (where e.event_type = 'CLOCK_OUT') as clock_out
        from app.attendance_events e
        where e.attendance_day = p_day
        group by e.user_id
      ) x
      join app.users u on u.id = x.user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on all functions in schema app from public;
grant execute on function
  app.admin_office_days(uuid),
  app.admin_day_attendance(uuid, date)
to attendance_app;
