@AGENTS.md

# Office Mate — First Mate Geofenced Attendance

Internal, **phone-first** PWA: a Team Member scans the office QR → signs in → taps Clock In / Clock Out →
the browser shares its location once → Postgres validates accuracy + geofence and writes an immutable event.

## Commands

```bash
npm run db:start            # local Supabase (Postgres :57322, Studio :57323)
npm run db:reset            # re-apply supabase/migrations + seed.sql
npm run dev                 # http://localhost:3000
npm run admin:create        # create/reset admin@firstmate.tech (prompts for password)
npm run verify              # format:check, lint, typecheck, unit, db (pgTAP), integration, build, e2e
npm test | npm run test:db | npm run test:integration | npm run test:e2e
```

## Source of truth

1. `docs/init.md` (spec) — with the owner's later decisions in `docs/implementation-plan.md` (Revision 1)
2. `docs/Geofenced Attendance.pdf` (approved proposal / mockups)
3. https://www.firstmate.tech/ for visual language

## Architecture rules

- **Postgres is the trust boundary.** `app.record_attendance()` derives the action, validates input →
  accuracy → radius, stamps time/day, and inserts atomically. Next.js passes only the verified user id,
  coordinates, accuracy, source, expected action, and the server `ATTENDANCE_TIMEZONE`.
- Everything lives in the private `app` schema; the app connects as least-privilege `attendance_app`
  (EXECUTE on vetted functions, no direct attendance-table privileges). New SQL needs explicit grants.
- Identity only via `features/auth/dal.ts` (`getViewer` / `requireViewer` / `requireAdminPage`) — call
  it in every page and Server Action. `proxy.ts` is an optimistic redirect only.
- Business rules live in `features/*/{model,messages,service,schema}.ts` and SQL, not in components.
- Styling only through tokens in `src/app/globals.css`; icons only from `lucide-react`.

## Guardrails (never violate)

- Auth (Better Auth): Team Members = Google Workspace SSO only (`hd=firstmate.tech`, verified server-side;
  first sign-in links to the row the Admin added, or creates the member from their Google names).
  Admin = `admin@firstmate.tech` email+password only (created by `npm run admin:create`). No self
  sign-up, no email flows. Linking is same-email only, onto verified rows, never the Admin
  (`validateUserInfo`). Deactivated members can't sign in (validateUserInfo + session hook) or clock
  (SQL). Admin allow-list: SQL `app.admin_emails()` = `features/auth/roles.ts` `ADMIN_EMAILS`. The
  Admin does NOT clock in/out (UI redirects, action + SQL refuse); their home is `/admin/attendance`.
- Clock Out rules (`/admin/team`): per member a fixed time or required hours, plus a today-only Admin
  lock/unlock. Enforced only in `app.record_attendance` (`clock_out_gate`); the browser just mirrors it.
- Never trust the browser for role, event type, timestamps, distance, or pass/fail.
- Location: one attempt per explicit tap (`requestBestPosition`: ≤3 sequential `getCurrentPosition`
  readings within ~20 s, stopping once accurate). No `watchPosition`, polling, or background use.
  Don't log coordinates.
- Attendance rows are write-once: no update/delete APIs, UI, or corrections.
- No offline attendance, no queued/replayed mutations; the service worker handles GET navigations only.
- Google Sheet = one-way mirror (`features/sheets`, queue `app.sheet_sync`): never read back, never block
  or fail a clock on it, never write coordinates.
- Secrets are server-only (no `NEXT_PUBLIC_*` secrets); `DATABASE_ADMIN_URL` is for tests/scripts only.

## Out of scope (v1)

dashboards/analytics/CSV (only the read-only Admin attendance log exists), multiple offices, Manager/custom roles,
role-management UI, attendance editing/deletion, spoof detection, payroll/HR features, per-weekday
schedules or shift rosters (the only rule is one Clock Out rule per member).

## Project skills

`.claude/skills/`: attendance-domain, geofence-validation, supabase-auth-security, firstmate-design,
pwa-guardrails, admin-settings, verify-attendance, vercel-deployment.
