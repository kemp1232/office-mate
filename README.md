# First Mate Attendance

A phone-first, installable web app that replaces the Google Form attendance sheet with an
**identity-verified, location-verified** Clock In / Clock Out.

```
Scan office QR → sign in (once) → tap Clock In → location checked once → recorded
```

- Team Members sign in with **Google Workspace SSO** (`@firstmate.tech` accounts only, checked server-side);
  their first sign-in makes them a Team Member. The single Admin (`admin@firstmate.tech`) uses email + password.
- The office geofence (one pin, radius, GPS accuracy threshold) is set by the Admin on a map.
- Every event is **write-once** and stores how it was validated (coordinates, accuracy, distance, the
  settings it was checked against, DB timestamp, source).
- Location is requested **only** when someone taps Clock In / Clock Out. Nothing is tracked.

> Scope, rules and decisions: [`docs/init.md`](docs/init.md) (spec), [`docs/implementation-plan.md`](docs/implementation-plan.md)
> (plan + Revision 1), [`docs/deployment.md`](docs/deployment.md), [`docs/design-system.md`](docs/design-system.md).

---

## Stack

| Concern          | Choice                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| App              | Next.js 16.3 (App Router, Turbopack, `proxy.ts`), React 19.3, TypeScript strict          |
| Database         | Supabase Postgres 17 — private `app` schema, SQL functions are the trust boundary        |
| Auth             | Better Auth 1.7 — Google Workspace SSO (members), email/password (Admin), DB rate limits |
| Map (Admin only) | MapLibre GL 6 + react-map-gl + OpenFreeMap tiles (free, no key)                          |
| UI               | Tailwind CSS 4 tokens, Satoshi font, lucide-react icons, React `<ViewTransition>`        |
| QR               | qrcode.react (SVG)                                                                       |
| Tests            | Vitest (unit + integration), pgTAP (`supabase test db`), Playwright (6 device projects)  |
| Hosting          | Vercel (Node 24, HTTPS)                                                                  |

## Architecture in one picture

```
phone ──HTTPS──► Next.js on Vercel
                  ├─ proxy.ts ............ optimistic "no session cookie → /login?next=…" only
                  ├─ /api/auth/* ......... Better Auth (Google OAuth + PKCE, origin checks, rate limits)
                  ├─ DAL (features/auth/dal.ts) ... verifies session on every page + action
                  └─ Server Actions ...... clockAction / saveSettingsAction
                         │  pg, as least-privilege role attendance_app
                         ▼
                  Postgres  app.record_attendance(user_id, lat, lng, accuracy, source, expected, tz)
                            ├─ verified @firstmate.tech user?  ├─ office configured?
                            ├─ input finite & in range?        ├─ accuracy ≤ threshold?  (first)
                            ├─ Haversine distance ≤ radius?    ├─ lock user+day → derive action
                            └─ insert immutable event (clock_timestamp, org-day, snapshots)
```

The browser can't choose the event type, the timestamp, the distance or the result. It sends
coordinates, accuracy, source (DIRECT/QR) and the action it was _showing_; if that no longer matches the
server-derived action, nothing is written and the real state comes back (safe retries / double taps).

### Project layout

```
src/app/                 routes (login, login/admin, attendance, admin/settings, admin/qr,
                         api/auth, manifest.ts, error/not-found)
src/features/attendance  model.ts (UI reducer), messages.ts (copy), geolocation.ts, service.ts, actions.ts, screen
src/features/auth        dal.ts, roles.ts, safe-next.ts, forms
src/features/settings    schema.ts, service.ts, actions.ts, settings-form.tsx, office-map.tsx
src/features/qr          qr-poster.tsx, qr-url.ts
src/components           ui/ (Button, Card, Field, StatusPanel), app-header, page-transition
src/lib                  auth.ts, auth-client.ts, db.ts, env.ts
supabase/migrations      app schema + role + Better Auth tables; attendance domain
supabase/tests/database  pgTAP suites
tests/                   unit/, integration/, e2e/, support/
scripts/                 create-admin.mts, generate-icons.mjs, copy-maplibre-worker.mjs
```

## Local development

Requirements: Node ≥ 22 (24 recommended), Docker, Supabase CLI ≥ 2.100.

```bash
npm install                     # also copies the MapLibre worker into public/vendor
cp .env.example .env.local      # then set BETTER_AUTH_SECRET: openssl rand -base64 32
npm run db:start                # Postgres :57322 · Studio :57323
npm run db:reset                # apply migrations + local seed (sets the local attendance_app password)
npm run admin:create            # create admin@firstmate.tech (hidden password prompt)
npm run dev                     # http://localhost:3000
```

Team Member sign-in needs a Google OAuth client: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local`
with redirect URI `http://localhost:3000/api/auth/callback/google` (see `docs/deployment.md` §2). Without it,
sign in at `/login/admin` as the Admin.
Location works on `localhost` (secure context). Use Chrome DevTools → Sensors to fake a position.

The local Supabase uses ports **573xx** so it can run next to other local Supabase projects.

## Commands

| Command                                                  | What it does                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                        | Next.js                                                                                   |
| `npm run lint` / `typecheck` / `format` / `format:check` | static checks                                                                             |
| `npm test`                                               | unit tests (Vitest, host TZ forced to UTC)                                                |
| `npm run test:db`                                        | pgTAP: privileges, geofence & day, state machine, immutability, settings                  |
| `npm run test:integration`                               | real Postgres as `attendance_app`: concurrency, retries, authorisation                    |
| `npm run test:e2e`                                       | Playwright: builds + starts the app; phones (320/412/430 px, landscape, WebKit) + desktop |
| `npm run verify`                                         | everything above, in order (the e2e step includes the production build)                   |
| `npm run admin:create`                                   | create/reset the Admin account (uses `DATABASE_URL`)                                      |

## Environment variables

All server-only (see [`.env.example`](.env.example)):

| Variable                                  | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                            | Postgres as `attendance_app` (prod: Supabase transaction pooler, port 6543) |
| `BETTER_AUTH_SECRET`                      | ≥ 32 random chars                                                           |
| `BETTER_AUTH_URL`                         | canonical https origin (auth, Google callback, QR target)                   |
| `ATTENDANCE_TIMEZONE`                     | org timezone defining the attendance day (default `Asia/Manila`)            |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | Google Workspace SSO OAuth client (server-only)                             |
| `DATABASE_ADMIN_URL`                      | **tests only** (privileged fixtures). Never set on Vercel.                  |

## Key behaviours

- **Attendance day** = calendar date in `ATTENDANCE_TIMEZONE`, computed in Postgres — never the Vercel
  (UTC) clock or the phone. One Clock In + one Clock Out per day.
- **Forgot to clock out?** Yesterday stays exactly as recorded (no automatic Clock Out, no edits). Today
  starts fresh with Clock In. _Known limitation:_ a shift crossing midnight can't clock out after midnight.
- **Geofence**: accuracy is checked before distance; `accuracy ≤ threshold` and `distance ≤ radius` pass.
  Defaults 300 m / 50 m; one office; starts unconfigured ("Attendance isn't set up yet").
- **QR**: one static code → `/attendance?source=qr`. It only opens the app; sign-in and location checks
  still apply and nothing is recorded until the user taps.
- **Offline**: attendance needs the network. Nothing is queued; the user sees "No connection – try again".

## Deployment

See [`docs/deployment.md`](docs/deployment.md) for the Supabase, Google OAuth, Vercel, Admin and first-run steps,
plus a production smoke test.

## Deferred to later versions

Google Sheets sync ([`docs/future-google-sheets-sync.md`](docs/future-google-sheets-sync.md)),
in-app reports, corrections workflow, multiple offices, shift handling across midnight.
