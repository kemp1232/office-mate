---
name: vercel-deployment
description: Production deployment checklist for Vercel + Supabase Postgres + Google OAuth. Use when deploying or changing environment configuration.
---

# Deploy checklist (details: `docs/deployment.md`)

1. **Supabase project** (region near Manila, e.g. Singapore). `supabase link --project-ref <ref>` →
   `supabase db push` (migrations only; `seed.sql` is local-only and never pushed).
2. **Runtime DB role**: in the SQL editor run
   `alter role attendance_app with login password '<generated 32+ chars>';`
   Connection string (transaction pooler, port 6543): `postgresql://attendance_app.<ref>:<pw>@<pooler-host>:6543/postgres`.
3. **Disable the Data API** (Dashboard → Integrations → Data API) — the app doesn't use PostgREST.
4. **Google OAuth client** (Google Cloud Console, in the firstmate.tech organisation): OAuth consent screen
   **Internal**; Credentials → OAuth client ID → Web application; authorised redirect URI
   `https://<domain>/api/auth/callback/google`.
5. **Vercel env (Production + Preview)**: `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`),
   `BETTER_AUTH_URL` (canonical https origin), `ATTENDANCE_TIMEZONE=Asia/Manila`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`. Never set `DATABASE_ADMIN_URL` or any `NEXT_PUBLIC_` secret. Node 24.
6. **Admin**: `DATABASE_URL=<prod app-role url> npm run admin:create` from a trusted machine.
7. **First-run**: Admin signs in → Settings → drop office pin → Save → print QR from /admin/qr.
8. **Smoke test on a phone**: Continue with Google with a @firstmate.tech account → back on Attendance →
   Clock In/Out at the office; confirm a personal gmail.com Google account is rejected; confirm a Team
   Member can't open /admin; Admin signs in at /login/admin.

HTTPS is automatic on Vercel (required for geolocation). Preview deployments share the prod DB unless you
point Preview `DATABASE_URL` at a separate Supabase branch — do that before inviting testers.
