# First Mate Attendance — v1 delivery report

Date: 2026-09-28 · Status: **implemented and verified locally.** No production accounts (Supabase
cloud, Vercel, Google Cloud OAuth client) have been created or configured; see "Manual setup checklist".

Owner decisions are recorded in `docs/implementation-plan.md` (Revisions 1–2). Authentication follows
the brief: **Team Members use Google Workspace SSO; the Admin uses email + password** — both through
Better Auth (instead of Supabase Auth), with Postgres as the trust boundary.

---

## 1. Architecture summary

A phone-first Next.js 16.3 PWA (App Router, React 19.3) on Vercel, backed by Supabase Postgres 17.
Better Auth 1.7 handles Google OAuth (PKCE, `hd=firstmate.tech`), the Admin password sign-in, sessions and
rate limiting, with its tables in Postgres.

**Postgres is the trust boundary.** The Next.js server verifies the session, then calls SECURITY DEFINER
functions as the least-privilege role `attendance_app`. `app.record_attendance` does all of the following:

- validates identity, configuration and input
- checks GPS accuracy before the radius
- computes the Haversine distance
- serialises per user and day
- derives Clock In or Clock Out
- stamps the database time and the org-timezone day
- inserts one immutable row

The browser only supplies coordinates, accuracy, source and the action it was showing (a precondition).

## 2. Project structure

See the README "Project layout". In short:

- `src/app` holds thin routes.
- `src/features/{attendance,auth,settings,qr}` holds rules, services, actions and UI.
- `src/components/ui` holds token-driven primitives.
- `src/lib` holds `auth`, `db` and `env`.
- `supabase/migrations` and `supabase/tests/database` hold the schema and pgTAP tests.
- `tests/{unit,integration,e2e,support}` holds the rest of the test suites.
- `.claude/skills/*` holds the 8 project skills.

## 3. Database schema

Everything lives in the private `app` schema.

| Table                                                           | Purpose                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`, `sessions`, `accounts`, `verifications`, `rate_limits` | Better Auth (snake_case, uuid). `users.email` is constrained to lower-case `…@firstmate.tech` with no `+` aliases.                                                                                                                                           |
| `attendance_settings`                                           | Singleton row: office lat/lng (null = unconfigured), `radius_m` (default 300; 10–5000), `accuracy_threshold_m` (default 50; 5–1000), `report_url` (https), `updated_at/by`.                                                                                  |
| `attendance_events`                                             | Write-once. Stores user id, email snapshot, `CLOCK_IN/CLOCK_OUT`, `attendance_day`, `recorded_at` (DB clock), submitted lat/lng/accuracy, computed distance, the settings snapshot it was checked against, `geofence_result='PASS'`, and source `DIRECT/QR`. |

Constraints on `attendance_events`:

- `unique (user_id, attendance_day, event_type)`
- the stored accuracy and distance must be within the stored limits
- a Clock Out requires an earlier Clock In on the same day (trigger)
- UPDATE, DELETE and TRUNCATE always raise (triggers, for every role)
- `on delete restrict` on users with history

## 4. Security model

- **Supabase Data API:** unused. `anon` and `authenticated` have no access to `app`.
- **`attendance_app` privileges:**
  - CRUD on the Better Auth tables, through RLS policies scoped `to attendance_app`
  - EXECUTE on five functions only
  - **no** attendance-table privileges
- **SQL functions:** pin `search_path = pg_catalog, pg_temp`. pgTAP enforces this and SECURITY DEFINER ownership.
- **Admin:** a hard-coded allow-list (`app.admin_emails()` = `ADMIN_EMAILS`, compared by a test). It is checked in the page, in the Server Action, and again inside SQL.
- **Team Members:** Google Workspace SSO only. Google's verified `hd` claim must be `firstmate.tech`
  (Better Auth rejects mismatches), then the email domain is checked again by a DB hook and a DB
  constraint. First sign-in creates the Team Member; there are no member passwords.
- **Admin:** email + password only; the password endpoint refuses every other address, and account
  linking is off so Google can never attach to the Admin account.
- **No self sign-up or email flows:** those endpoints are disabled; no SMTP.
- **Rate limits:** database-backed, per IP (Vercel's `x-real-ip`):
  - Admin password sign-in 10/min
  - Google sign-in starts 30/min
  - These are sized for one shared office Wi-Fi IP.
- **Security headers:** X-Frame-Options DENY, `frame-ancestors 'none'`, nosniff, Referrer-Policy, a Permissions-Policy that allows geolocation only for self, and HSTS.
- **Secrets:** all server-only. No `NEXT_PUBLIC_` values. Coordinates are never logged.

## 5. Attendance state machine

`none → CLOCK_IN → CLOCK_OUT → DAY_COMPLETE` per user and attendance day, derived on the server.

- If the client's `expectedAction` doesn't match the derived action, `STATE_CHANGED` is returned with the real state and nothing is written. This covers double taps, retries and stale tabs.
- The UI "Try again" never performs a different action than the one tapped.
- If a response is lost after the server committed, the app re-reads state and shows "You're already clocked in at 09:04".

## 6. Attendance day and timezone

- The attendance day is the calendar date in `ATTENDANCE_TIMEZONE` (server env, default `Asia/Manila`).
- It is computed in Postgres from `clock_timestamp()`, never from the phone or Vercel's UTC clock.
- If someone forgets to Clock Out, that day stays as recorded (no automatic Clock Out, no edits), and the next day starts at Clock In.
- The open app re-reads state at the org-day rollover and when resumed.

## 7. Geofence

- The order is: accuracy check → Haversine distance (R = 6,371,008.8 m) → radius check, with `≤` passing at both boundaries.
- Tests cover 299.5 m (inside) and 300.5 m (outside), accuracy exactly equal to the threshold, NaN and Infinity input, the antimeridian, and known distances.
- There is one office. It starts unconfigured, which means "Attendance isn't set up yet".
- Location is requested only by an explicit tap (`getCurrentPosition` once; never `watchPosition`).

## 8. Mobile-first UX

- One focused screen:
  - date and greeting
  - a today card (dark "Clocked in 09:04 · Elapsed" card, as in the mockups)
  - a status panel
  - a 64px Clock In / Clock Out button (orange for Clock Out) anchored in the thumb zone
- Status messages appear above the button without moving it.
- Short landscape switches to two columns.
- Layout details: safe-area utilities, `100dvh`, 44px minimum touch targets, and Satoshi with First Mate tokens.
- Page transitions are a 0.6 s fade-through (300 ms out, 300 ms in) using React `<ViewTransition>`, respecting reduced motion.
- Admin Settings has a map, fields and a sticky save bar on phones, and becomes two columns on desktop.
- The QR page has a print layout.

## 9–12. Authentication, Supabase, Google OAuth and Admin setup

Full instructions are in `docs/deployment.md`:

- §1 Supabase
- §2 Google Workspace OAuth client (Internal consent screen, redirect URI `/api/auth/callback/google`)
- §4 Admin account: `npm run admin:create`, with a hidden password prompt

## 13. Environment variables

| Name                                        | Where              | Notes                                                                      |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Vercel + local     | `attendance_app` role; production uses the transaction pooler on port 6543 |
| `BETTER_AUTH_SECRET`                        | Vercel + local     | ≥ 32 random characters                                                     |
| `BETTER_AUTH_URL`                           | Vercel + local     | canonical https origin                                                     |
| `ATTENDANCE_TIMEZONE`                       | Vercel + local     | `Asia/Manila`                                                              |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Vercel + local     | Google Workspace OAuth client (optional locally)                           |
| `DATABASE_ADMIN_URL`                        | tests/scripts only | never on Vercel                                                            |

## 14. Map provider

- **Provider:** OpenFreeMap "liberty" vector tiles.
  - Free, no API key, commercial use allowed.
  - Attribution is shown automatically.
  - No SLA, but the map is used only by the Admin.
- **Library:** MapLibre GL JS 6.11 with react-map-gl 8.1.
- **Setup:** the worker file is copied to `/public/vendor` on install, dev and build. No env vars are needed.

## 15. PWA

- `app/manifest.ts`: standalone display, 192/512/maskable icons generated from the First Mate mark, and an apple-touch icon.
- `viewportFit: cover`.
- A minimal service worker handles only GET navigations, to show `/offline.html`. It never caches or replays mutations and has no background sync.

## 16. Vercel deployment

`docs/deployment.md` §3, plus the `vercel-deployment` skill.

## 17. First-run Admin configuration

`docs/deployment.md` §5: sign in → drop the office pin → check radius and accuracy → save → print the QR.

## 18–19. Test and verification commands

```bash
npm run db:start && npm run db:reset
npm run verify        # format · lint · typecheck · unit · pgTAP · integration · e2e (incl. production build)
```

Last full run, 2026-09-29, all passing:

| Suite       | Result                   |
| ----------- | ------------------------ |
| Unit        | 91                       |
| pgTAP       | 90                       |
| Integration | 17                       |
| Playwright  | 89 (1 skipped by design) |

The Playwright projects were: iPhone SE 320px, Pixel 7, iPhone 15 Pro Max, phone landscape, **real WebKit** iPhone 13, and desktop 1440.

## 20. Known limitations

- A shift that crosses midnight can't Clock Out after midnight, because the attendance day has changed.
- Location comes from the browser, so it can be spoofed (DevTools or a mock-location app). Advanced anti-spoofing is out of scope by design.
- OpenFreeMap has no SLA (it only affects the Admin map).
- Real Google sign-in is only exercised manually (tests stub Google and inject a session).
- There's no Admin password reset by email: re-run `npm run admin:create`.
- Next.js logs "destination stream closed early" when the browser cancels a link prefetch. This is harmless.
- The tests reset the **local** Admin password to `admin-e2e-password-123`. They never touch production.
- No full Content Security Policy yet (baseline headers only).
- Installed-PWA standalone mode and real-GPS accuracy haven't been verified on physical devices.

## 21. Deferred to v2

Google Sheets sync (`docs/future-google-sheets-sync.md`),
in-app reports, a corrections workflow, multiple offices, shift handling across midnight, and a full CSP.

## 22. Assumptions and decisions

All in `docs/implementation-plan.md`. Highlights:

- Better Auth instead of Supabase Auth.
- Google Workspace SSO (`hd`) for members, email + password for the single Admin, no account linking.
- Timezone as an env var.
- The accuracy threshold can go up to 1000 m, so 300 m is possible for indoor use.
- MapLibre v6 with the worker served from `/public`.
- Light theme only, 24-hour time format, English only.

---

## Definition of Done status

✅ = verified by automated tests or by running the app. ⚠️ = partially verified, or needs real
devices or accounts. ↺ = superseded by the owner's decision.

**Architecture:**

- ✅ App runs
- ✅ Strict TypeScript
- ✅ Migrations
- ✅ Configuration docs
- ✅ `.env.example`

**Auth:**

- ✅ Team Member Google OAuth (redirect, `hd`, PKCE, return path verified; the real Google round trip needs manual testing)
- ✅ `@firstmate.tech` enforced on the server
- ✅ Outside-domain accounts rejected
- ✅ Admin email/password login
- ✅ Admin password not committed
- ✅ Server-controlled Admin
- ✅ Team Members blocked from Admin pages
- ✅ QR return path preserved through Google sign-in

**Attendance:**

- ✅ Every item, including 10-way concurrency, retries after a lost response, and the timezone set by env var

**Geofence:**

- ✅ Every item

**Immutability:**

- ✅ Every item

**QR:**

- ✅ Every item

**Reporting:**

- ✅ Report link and Open Report
- ✅ No in-app reports
- ✅ No Sheets or Apps Script sync

**PWA:**

- ✅ Manifest and icons
- ✅ HTTPS-compatible
- ✅ No offline queue
- ⚠️ Install and standalone layout: emulated only. Check on an iPhone and an Android phone.

**Mobile:**

- ✅ Every item verified with emulated devices and real WebKit
- ⚠️ Real-device GPS and home-screen launch

**UI/design:**

- ✅ Every item

**Testing:**

- ✅ Every item

**Verification:**

- ✅ Launched and screenshots reviewed
- ✅ Security, QA, UI/UX, code-review and simplification reviews completed, and their findings fixed

## Manual setup checklist (needs your accounts)

1. [ ] Create the Supabase project, then run `supabase link` and `supabase db push`.
2. [ ] Set the `attendance_app` password and build the pooler `DATABASE_URL`.
3. [ ] Disable the Supabase Data API.
4. [ ] Create the Google OAuth client (Internal consent screen, redirect URI `https://<domain>/api/auth/callback/google`).
5. [ ] Create the Vercel project with Node 24 and the environment variables in §13.
6. [ ] Optionally add a custom domain, then update `BETTER_AUTH_URL`.
7. [ ] Run `npm run admin:create` against production and store the password in the team password manager.
8. [ ] First-run configuration: office pin, radius and accuracy, then print the QR.
9. [ ] Run the production smoke test in `docs/deployment.md` §6 on a real iPhone and Android phone.
