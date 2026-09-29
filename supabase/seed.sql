-- LOCAL DEVELOPMENT ONLY (applied by `supabase db reset`, never pushed to hosted projects).
-- Lets the Next.js dev server connect as the least-privilege runtime role.
alter role attendance_app with login password 'attendance_app_local_dev';
