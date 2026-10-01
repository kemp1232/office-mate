---
name: supabase-auth-security
description: Authentication, authorisation and secret-handling rules (Better Auth on Supabase Postgres, @firstmate.tech restriction, Admin allow-list, DB privileges). Use before touching auth, sessions, roles, SQL grants, env vars or any Server Action.
---

# Auth & security

## Authentication (Better Auth)

- `src/lib/auth.ts` (server-only). Tables in `app.users/sessions/accounts/verifications/rate_limits`.
- **Team Members → Google Workspace SSO only.** `socialProviders.google` with `hd: "firstmate.tech"`: Google
  shows only Workspace accounts AND Better Auth rejects any ID token whose verified `hd` claim differs
  (callback error `unable_to_get_user_info`). `databaseHooks.user.create.before` re-checks the email
  domain (`EMAIL_DOMAIN_NOT_ALLOWED`) and the DB constraint `users_email_org_domain` checks it again.
  A valid account becomes a Team Member on first sign-in; Google's `email_verified` sets `email_verified`.
- **Pre-added members** (Admin Team page, prefilled list) are `app.users` rows with `email_verified = true`
  and no account. Their first Google sign-in links Google to that row: `accountLinking.enabled`, same
  email only (`allowDifferentEmails: false`), Better Auth's verified-local-row gate, no profile overwrite
  (`updateUserInfoOnLink: false`, no `overrideUserInfoOnSignIn`). `mapProfileToUser` gives new members
  `firstName`/`lastName` (`additionalFields` → `first_name`/`last_name`; `name` is derived by a DB trigger).
- `user.validateUserInfo` (link-account + sign-in): refuses the Admin email (`ADMIN_USES_PASSWORD`),
  non-org emails, and deactivated users (`ACCOUNT_DEACTIVATED`). `databaseHooks.session.create.before`
  refuses deactivated users on every path. Deactivation (`app.admin_set_member_active`) also deletes
  their sessions; `getViewer` ignores a user with `deactivatedAt`.
- **Admin → email + password only**, for `admin@firstmate.tech`, created/reset by `npm run admin:create`
  (hidden prompt, scrypt hash only — never commit, log, or env-var it). A `hooks.before` on
  `/sign-in/email` refuses every other address (`USE_GOOGLE_SIGN_IN`).
- `emailAndPassword.disableSignUp`; `encryptOAuthTokens`. Google can never attach to the Admin account
  (validateUserInfo), and `/link-social` stays disabled.
- Disabled endpoints: sign-up, password reset/change/set, email verification, update-user, change-email,
  delete-user, link/unlink. There is no SMTP.
- Sign-in goes through `/api/auth/*` via `authClient` so origin checks and **DB-backed per-IP rate
  limits** apply (`x-real-ip` from Vercel): password 10/min, social 30/min.
- Google callback URI: `${BETTER_AUTH_URL}/api/auth/callback/google`. `GOOGLE_CLIENT_ID/SECRET` are server-only.
- SECURITY DEFINER functions: `set search_path = pg_catalog, pg_temp` (pgTAP enforces).

## Authorisation

- Two roles only: Admin (email ∈ `ADMIN_EMAILS` / `app.is_admin`) and Team Member (any other verified org user).
- Pages: `requireViewer()` / `requireAdminPage()`. Server Actions: `getViewer()` then check role — every time.
- Admin is checked AGAIN inside SQL (`get_admin_settings`, `update_admin_settings`, `admin_team`,
  `admin_save_member`, `admin_set_clock_out_override`, `admin_set_member_active`).
- Never accept role, isAdmin, event type, timestamps, distance or geofence result from the client.
- `proxy.ts` is only an optimistic cookie redirect — never rely on it for security.

## Database privileges ("RLS" strategy)

- Private `app` schema, not exposed via the Supabase Data API; `anon`/`authenticated` have nothing.
- Runtime role `attendance_app`: CRUD on Better Auth tables (RLS policies `to attendance_app`), EXECUTE on
  `get_attendance_state`, `record_attendance`, `get_admin_settings`, `update_admin_settings`, `is_admin` — no
  attendance-table privileges. SECURITY DEFINER functions pin `search_path = pg_catalog, pg_temp`.
- Every new function: `revoke execute ... from public`, grant explicitly; every new table: RLS on + explicit grants.

## Secrets

- Server-only env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (Sheets export),
  `ATTENDANCE_TIMEZONE`. No `NEXT_PUBLIC_` secrets. `DATABASE_ADMIN_URL` is tests/scripts only — never Vercel.
- Validate env with `src/lib/env.ts`.

## Notes

Tests can't run real Google: E2E asserts the authorize redirect (`hd`, redirect URI, PKCE, state) and
then injects a signed session cookie (`tests/support/db.ts` `sessionCookieFor`).
