# First Mate Geofenced Attendance — Implementation Plan (v1)

Status: **approved 2026-09-28 with Revisions 1–2 below.** Research date: 2026-09-28.

## Revision 2 — 2026-09-29 (supersedes Revision 1's authentication rows)

| Topic | Decision |
|---|---|
| Team Members | **Google Workspace SSO** via Better Auth's Google provider with `hd: "firstmate.tech"` (Google verifies the hosted-domain claim; Better Auth rejects mismatches server-side). First sign-in creates the Team Member. No member passwords, no self sign-up form. |
| Admin | **Email + password** for `admin@firstmate.tech` only (created/reset by `npm run admin:create`; `/login/admin`). The password endpoint refuses every other address. |
| Identity linking | Implicit account linking disabled, so a Google sign-in can never attach to (or duplicate) the Admin account. |
| Email/SMTP | Removed — no sign-up, verification or reset emails exist. |
| Tests | Real Google can't run in CI: E2E asserts the authorize redirect (`hd`, redirect URI, PKCE, state, QR destination) and injects a signed Better Auth session for the member. |

## Revision 1 — owner decisions at approval (supersede the sections below where they conflict)

| Topic | Original plan | Decision |
|---|---|---|
| Authentication | Supabase Auth + Google Workspace SSO; Admin via Supabase email/password | **Better Auth** (library) with **email + password for everyone**. Google SSO deferred to a later version. |
| Sign-up | Automatic on first Google login | Self sign-up restricted to `@firstmate.tech`, **email verification required** before sign-in (SMTP; Resend recommended). After the security review: sign-up reserves the address and the emailed link is where the password is created (that is the verification), preventing account squatting. Password reset by email. |
| Admin | Created in Supabase dashboard | `admin@firstmate.tech`, created/reset with `npm run admin:create` (hidden prompt); reserved from public sign-up. |
| Trust boundary | SQL RPCs called with the user's Supabase JWT + RLS | Same SQL functions (`app.record_attendance`, …), called by the Next.js server as least-privilege role `attendance_app` with the session-verified user id. Private `app` schema; Data API unused. |
| Timezone (Q-A) | DB config row | **`ATTENDANCE_TIMEZONE=Asia/Manila` server env var**, passed to the SQL functions (never from the client). |
| Google `hd` (Q-B) | Require hd | N/A until SSO is added (noted in the auth skill). |
| Accuracy threshold | Default 50 m | Default stays 50 m; allowed range 5–1000 m so the Admin can set **300 m** for indoor use. |
| Mockups | Not provided | `docs/Geofenced Attendance.pdf` — used for state designs (dark clocked-in card, orange Clock Out, peach warning, dashed map radius). |

Implementation-time decisions (incl. review fixes): SQL functions pin `search_path = pg_catalog, pg_temp`; baseline security headers; plus-addressed emails rejected; retry never performs a different action than the one tapped; state resyncs on app resume and at the org-day rollover; MapLibre GL **v6** (worker served from `/public/vendor`, copied on
`postinstall`); a Clock Out is timestamped with `clock_timestamp()` *after* the per-user/day advisory lock
(found by the concurrency test); Playwright runs 6 device projects incl. real WebKit.

---

---

## 1. Architecture

```
Phone (PWA / browser)
  └─ Next.js 16 App Router on Vercel (Node 24)
       ├─ proxy.ts            → refreshes Supabase session cookie + optimistic redirects only
       ├─ Server Components   → read state through a server-only Data Access Layer (DAL)
       ├─ Server Actions      → clock action, admin settings save, sign in / sign out
       └─ /auth/callback      → OAuth PKCE code exchange (Route Handler)
  └─ Supabase
       ├─ Auth: Google OAuth (team members), email+password (admin only)
       ├─ Auth hook: before_user_created → rejects non-@firstmate.tech sign-ups
       └─ Postgres: tables + RLS + SECURITY DEFINER RPCs (the real trust boundary)
```

**Key principle: Postgres is the authoritative trust boundary.** Validating the geofence, deriving the next action, stamping the attendance day and timestamp, and writing the record all happen inside one Postgres function (`record_attendance`). That function runs in a single transaction and is called with the *user's own JWT*.

- Even if someone bypasses the Next.js UI and calls the Supabase API directly with their own session, they hit exactly the same validation.
- The production app needs **no Supabase secret/service-role key at runtime**. That key is only used for local tests.
- Next.js adds the following on top: input validation with zod, session verification (`getClaims()`), friendly error mapping, and the UI.

Business rules are kept out of React. The SQL is tested with pgTAP and with integration tests. The small TS modules (safe redirect, input schemas, result → UI-state mapping, time formatting) are unit-tested with Vitest.

## 2. Supporting libraries (versions verified on npm 2026-09-28)

| Purpose | Library | Why |
|---|---|---|
| Framework | `next@16.3.x`, `react@19.3` | Required; current stable. React 19.3 has stable `<ViewTransition>`. |
| Supabase | `@supabase/ssr@0.12.x`, `@supabase/supabase-js@2.117.x` | Official SSR cookie/session package. |
| Styling | `tailwindcss@4.3` (create-next-app default) | CSS-first `@theme` gives centralized design tokens. The First Mate site itself uses Tailwind v4. |
| Validation | `zod@4` | Server input validation for actions. |
| Icons | `lucide-react` | One consistent icon set, React 19 supported. |
| Map | `maplibre-gl` + `react-map-gl` (`/maplibre`) | Open source, strong touch support. See §16. |
| QR | `qrcode.react` (`QRCodeSVG`) | Zero dependencies, SVG output that prints crisply, React 19 peer dependency. |
| Font | Satoshi (self-hosted via `next/font/local`) | This is the font the First Mate site uses. It is free for commercial use under the Fontshare ITF license. |
| Tests | `vitest@5`, `@playwright/test@1.63`, pgTAP (`supabase test db`) | Unit, E2E with geolocation/device/offline emulation, and DB/RLS tests. |
| Lint/format | ESLint (Next default config) + Prettier | Standard. |

Deliberately **not** used:
- Serwist/next-pwa: no offline mode is needed. A 30-line hand-written service worker is safer (see §17).
- PostGIS: Haversine is enough for a single radius check.
- Any state library, UI kit, or ORM.

## 3–5. Database schema & constraints

**`public.attendance_settings`**: a singleton row (`id boolean primary key default true check (id)`).

| column | type | notes |
|---|---|---|
| office_latitude / office_longitude | double precision, nullable | Both null (unconfigured) or both set. Range checks. |
| radius_m | integer not null default 300 | check 10–5000 |
| accuracy_threshold_m | integer not null default 50 | check 5–1000 |
| report_url | text not null default '<the Google Sheet URL>' | check `^https://` + length limit |
| updated_at, updated_by | timestamptz, uuid | Set by trigger, not by the client. |

**`private.org_config`**: not exposed through the API and not editable by Admin.
- `attendance_timezone text not null default 'Asia/Manila'`, with a check that it is a valid `pg_timezone_names` entry. See §9 and Open Question A.

**`public.attendance_events`**: write-once.

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| user_id | uuid not null → auth.users(id) **on delete restrict** | History can't disappear by deleting a user. |
| email | text not null | Snapshot at the time of the event. |
| event_type | enum `attendance_event_type` ('CLOCK_IN','CLOCK_OUT') | |
| attendance_day | date not null | Computed in the DB from `now()` in the org timezone. |
| recorded_at | timestamptz not null default now() | Trusted DB timestamp. This is also the immutable creation time. |
| latitude, longitude, accuracy_m | double precision not null | Values submitted by the browser and used for validation. |
| distance_m | double precision not null | Calculated by the DB. |
| office_latitude, office_longitude, radius_m, accuracy_threshold_m | snapshot | The exact settings the event was validated against. |
| geofence_result | text not null check = 'PASS' | Only passing attempts are recorded. Rejections write nothing, as the spec requires. |
| source | enum ('DIRECT','QR') | |

Constraints:
- `unique (user_id, attendance_day, event_type)` means at most one Clock In and one Clock Out per day. This is the backstop against races.
- `check (distance_m <= radius_m and accuracy_m <= accuracy_threshold_m)` makes a stored record self-evidently valid.
- A `BEFORE INSERT` trigger rejects a CLOCK_OUT if there is no CLOCK_IN for the same user and day. Clock-ins can never be deleted, so this check stays true.
- A `BEFORE UPDATE OR DELETE` trigger plus a `BEFORE TRUNCATE` trigger **always raise**, even for service_role and dashboard SQL. Immutability is enforced below RLS.
- Index on `(user_id, attendance_day)`, which the unique constraint already provides.

There is no `profiles` table. The spec allows it "if needed", and v1 doesn't need it.

## 6. RLS / grants strategy

New Supabase projects (created after 2026-05-30) no longer auto-grant table access. Every migration therefore contains **explicit grants**. Locally `auto_expose_new_tables = false` so local matches cloud.

- `attendance_events`:
  - RLS on.
  - `authenticated` gets **SELECT only**, with policy `user_id = (select auth.uid())`, so users see only their own rows.
  - No INSERT, UPDATE or DELETE grant for anyone. Inserts happen only inside `record_attendance` (SECURITY DEFINER).
  - `anon` gets nothing.
- `attendance_settings`:
  - RLS on.
  - SELECT and UPDATE policies both use `(select private.is_admin())`.
  - Column-level `GRANT UPDATE (office_latitude, office_longitude, radius_m, accuracy_threshold_m, report_url)`.
  - No INSERT or DELETE.
  - Team members can't read it at all. They get only what they need (configured yes/no, plus radius and threshold in error messages) through `get_attendance_state` / `record_attendance`.
- `private` schema: not exposed through the API. It holds `is_admin()`, `is_team_member()`, `attendance_day(ts)`, `distance_m(...)` and `org_config`. Helper functions are `security definer set search_path = ''` with fully qualified names. Execute is granted narrowly.
- `private.is_admin()` reads `auth.users.email` for `auth.uid()` (server-side truth, not `user_metadata` and not anything the browser sends) and compares it to the hard-coded allow-list `admin@firstmate.tech`.
- `private.is_team_member()` checks that the email is confirmed and that the email domain is exactly `firstmate.tech` (compared after lowercasing).
- Every public RPC does `revoke execute from public, anon` and `grant execute to authenticated`.

## 7. Attendance transaction design

`public.record_attendance(p_latitude, p_longitude, p_accuracy_m, p_source, p_expected_action) returns jsonb`. It is SECURITY DEFINER and runs in one transaction, in this order:

1. `auth.uid()` present → else `UNAUTHENTICATED`
2. `is_team_member()` (domain) → else `FORBIDDEN`
3. Settings configured (office coordinates not null) → else `NOT_CONFIGURED`
4. Validate inputs: finite numbers (rejects NaN and ±Infinity), lat within −90…90, lng within −180…180, 0 < accuracy ≤ 100000. Anything else → `INVALID_INPUT`
5. `accuracy > threshold` → `ACCURACY_TOO_LOW {accuracy, threshold}` (checked **before** the radius)
6. Compute the Haversine distance
7. `distance > radius` → `OUTSIDE_GEOFENCE {distance, radius}`
8. `pg_advisory_xact_lock(hash(user_id, day))` serializes concurrent requests for that user and day. It then reads today's events and **derives** the action: none → CLOCK_IN, clock-in only → CLOCK_OUT, both → `DAY_COMPLETE`.
9. If the derived action ≠ `p_expected_action` → `STATE_CHANGED {current state}`, and nothing is written.
10. INSERT with DB `now()`, the computed day and the snapshots. Return `{ok, event, state}`.

Rejections are **returned** as structured results, not raised, so no row is ever written for a failed attempt. Unique violations, which can only happen if the lock logic were bypassed, are caught and mapped to `STATE_CHANGED`.

**Why `p_expected_action`?** It is a precondition, not an instruction.
- The server still decides the event type. The browser can only cause a *no-op* if its view is stale.
- Without it, a double-tap or a network retry of "Clock In" arriving after the first one committed would legitimately become an instant **Clock Out**.
- With it, a retry returns `STATE_CHANGED` along with the real state, and the UI simply shows "Clocked in at 09:04". This gives idempotent retries without an idempotency-key table.

`public.get_attendance_state()` returns:
- `{configured, attendance_day, timezone, clock_in_at, clock_out_at, next_action: CLOCK_IN|CLOCK_OUT|DAY_COMPLETE, is_admin}`
- It is used by the Attendance page, and `next_action` is always derived on the server.

## 8. Attendance state machine

```
             (no events today)            (clock-in only)             (both)
 today ──►  READY_TO_CLOCK_IN ──clock in──► CLOCKED_IN ──clock out──► DAY_COMPLETE (terminal until next day)
```

The UI adds transient states that are never persisted:
- CHECKING_LOCATION → VERIFYING → success, or one of these errors: PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT, ACCURACY_TOO_LOW, OUTSIDE_GEOFENCE, OFFLINE, NOT_CONFIGURED, STATE_CHANGED (UI resyncs).
- These are modelled as a pure reducer in `features/attendance/model.ts`, so they are unit-testable without rendering.

## 9. Attendance day / timezone

- `attendance_day = (now() at time zone <org tz>)::date`, computed in Postgres by the single function `private.attendance_day(timestamptz)`. The browser and Vercel's UTC clock are never used.
- **Forgotten clock-out:** yesterday's lone CLOCK_IN is left as-is. No automatic clock-out is created, nothing is modified, and today starts again at READY_TO_CLOCK_IN. This will be documented in README and in the `attendance-domain` skill.
- The org timezone is returned by `get_attendance_state`, so the UI formats times (`Intl.DateTimeFormat` with `timeZone`) in Manila time, not in the phone's or Vercel's timezone.
- **Where the timezone lives:** see Open Question A. The recommendation is to store it in DB config rather than a Vercel env var, because the DB is what computes the day.

## 10. Geofence calculation

- Haversine in SQL with the mean Earth radius 6,371,008.8 m. This is accurate to ≪1 m at 300 m scale, which is far below GPS error, and needs no PostGIS extension.
- Boundaries: `distance ≤ radius` passes, and `accuracy ≤ threshold` passes.
- Tests cover the exact boundary, ±0.5 m either side, the antimeridian/poles sanity cases, and a known-distance fixture (e.g. two Manila landmarks).
- The browser never sends inside/outside, a distance, or a timestamp. It sends only `latitude, longitude, accuracy, source, expected_action`.

## 11. Google auth flow (team members)

1. `/login?next=/attendance?source=qr` → user taps **Continue with Google**.
2. `signInWithOAuth({ provider: 'google', options: { redirectTo: <SITE_URL>/auth/callback?next=<safe next>, queryParams: { hd: 'firstmate.tech', prompt: 'select_account' } } })`, using PKCE. The `hd` value is only a UI hint on Google's account picker.
3. Supabase → Google → Supabase. On first sign-up, the **before_user_created hook** (Postgres function) runs:
   - It rejects with 403 unless the email domain is `firstmate.tech` **and** Google's `hd` claim is `firstmate.tech` (see Open Question B).
   - It also rejects any email/password sign-up that isn't the Admin address.
4. `/auth/callback` runs `exchangeCodeForSession(code)` and then redirects to `next`.
   - `next` is sanitized: it must start with a single `/`, and `//`, `\` and schemes are rejected. The official Supabase snippet has an open-redirect gap here.
   - On error, it redirects to `/login?error=domain|oauth` with a plain-language message.
5. Defense in depth for existing sessions: the DAL checks `is_team_member` on every protected request and signs out any user outside the domain. The DB functions check the domain again. So even if the hook were ever mis-configured in production, an outside account could not record attendance.

## 12. Admin auth flow

- `/admin/login`: an email + password form that runs `signInWithPassword` in a Server Action.
- Public email sign-ups are disabled (`[auth.email] enable_signup = false`).
- The Admin user is created once by a human in the Supabase Dashboard (Authentication → Add user, auto-confirm) with a password generated in a password manager. It is never committed, never in env vars, and there is no default. Instructions go in the README.
- Admin status comes from `private.is_admin()` on the server. It is never read from a request body, a cookie or user metadata.
- **Identity linking:** Supabase auto-links a verified-email OAuth identity to an existing user with the same email. If `admin@firstmate.tech` ever clicks "Continue with Google", it becomes a second identity on the **same** user, so no duplicate user or profile can appear.
  - We still present Admin → password and Team Member → Google, as the spec prefers.
  - Email confirmation stays on, and the Admin is created pre-confirmed, so the pre-account-takeover edge case doesn't apply.

## 13. Routing

| Route | Access | Notes |
|---|---|---|
| `/` | any | redirects to `/attendance` if authenticated, else `/login` |
| `/login` | public | Google primary; small "Admin sign in" link |
| `/admin/login` | public | email/password |
| `/auth/callback` | public | Route Handler |
| `/attendance` (`?source=qr`) | team member / admin | the main phone screen |
| `/admin/settings` | admin | map, radius, accuracy, report link, "Open report" |
| `/admin/qr` | admin | QR display plus a print layout |
| sign out | Server Action | POST only |

- `proxy.ts` does two things: session refresh, and a cheap optimistic redirect of unauthenticated users to `/login?next=<path+query>`. That redirect is how QR `source=qr` survives login.
- The real checks happen in the DAL (`requireUser()`, `requireAdmin()`), which runs in every protected page and every Server Action.
- A team member on `/admin/*` is redirected to `/attendance`, and admin Server Actions return `FORBIDDEN`. RLS independently denies the writes.

## 14. UI / component structure

```
src/
  app/            routes only (thin)
  features/
    attendance/   model.ts (reducer), messages.ts, geolocation.ts, AttendanceScreen.tsx, actions.ts
    auth/         dal.ts (server-only), safe-next.ts, actions.ts
    settings/     schema.ts, OfficeMap.tsx (client, dynamic ssr:false), SettingsForm.tsx, actions.ts
    qr/           QrPoster.tsx
  components/ui/  Button, Card, StatusPanel, Field, AppHeader, Spinner (token-driven)
  lib/supabase/   client.ts, server.ts, proxy.ts, database.types.ts (generated)
  proxy.ts
supabase/         config.toml, migrations/, tests/database/*.sql, seed.sql (local only)
tests/            unit/, integration/ (vitest vs local Supabase), e2e/ (playwright)
```

## 15. Mobile-first approach

The Attendance screen is designed at 360–430 px first. It is one focused screen laid out top to bottom:
- compact header (logo mark, name, avatar/sign-out)
- a status card (today's date and state, e.g. "Not clocked in yet" or "Clocked in 09:04 · Elapsed 3h 12m")
- a **dominant ≥64 px-tall, full-width primary action** anchored in the bottom (thumb) zone
- a live-region status and error panel
- one privacy line: "Location is checked once, only when you tap."

Layout details:
- `min-height: 100dvh`, and `env(safe-area-inset-*)` padding so the bottom action clears the home indicator.
- `viewport-fit=cover`.
- No hover-only interactions, and all secondary controls are ≥44×44 px.
- Tablet and desktop: the content stays centered at max-width ~440 px.
- Admin settings are single-column on phones, with a sticky safe-area-aware Save bar. On ≥1024 px they become two columns (map left, fields right).

Elapsed time ticks every 30 s using the clock only. There is **no** geolocation outside the tap: no `watchPosition`, no polling. The request uses `getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })`.

## 16. Map provider

**MapLibre GL JS + react-map-gl/maplibre + OpenFreeMap "liberty" vector tiles.**
- OpenFreeMap is free with no view limits, needs **no API key and no sign-up**, and explicitly allows commercial use. It requires attribution, which MapLibre renders automatically.
- Alternatives rejected:
  - MapTiler free tier is non-commercial only.
  - Stadia free tier forbids commercial use.
  - Protomaps' hosted API is non-commercial, or self-hosted infrastructure.
  - OSM's `tile.openstreetmap.org` tile servers allow blocking without notice and are discouraged for apps.
  - Google and Mapbox need billing accounts and keys.
- Limitations: OpenFreeMap has no SLA and is donation-funded. The map is used **only** by the Admin to set the pin, so an outage never affects Clock In/Out. It can later be swapped for self-hosted OpenFreeMap or a paid style URL with a one-line change.
- UX:
  - tap to place the pin, then drag to move it
  - a translucent circle shows the current radius
  - a "Use my current location" button centers the map (explicit tap only)
  - `cooperativeGestures` stops the page scroll from being trapped on phones
  - read-only coordinates are shown as small technical text
- Version note: MapLibre v6 is ESM-only and needs a worker-URL setup under Turbopack. I'll try v6 first and fall back to the latest 5.x if it's fragile, and document which was used.
- Env vars: none.

## 17. PWA approach

- `app/manifest.ts`: name "First Mate Attendance", short_name "Attendance", `start_url: '/attendance'`, `display: 'standalone'`, theme and background colors from the tokens.
- Icons: 192, 512 and a maskable 512, generated from the First Mate mark, plus a 180 px apple-touch-icon and `appleWebApp` metadata.
- `viewport` export with `themeColor` and `viewportFit: 'cover'`.
- **Minimal hand-written `public/sw.js`:**
  - It intercepts **only GET navigations**, and only to show a cached branded `/offline.html` ("No connection – try again") when the network fails.
  - It never caches or replays POSTs, Server Actions, RSC payloads or API responses, and has no background sync.
  - It also satisfies Chrome's stricter automatic-install-prompt heuristics.
- HTTPS comes from Vercel. Geolocation requires a secure context, and localhost counts as secure in development.

## 18. Design system approach

The tokens come from inspecting firstmate.tech, which runs on Next.js + Tailwind v4:

| Token | Value |
|---|---|
| accent | `#424bd1` |
| ink (body text) | `#282943` |
| heading ink | `#131313` |
| muted surface | `#f9f9f9` |
| hairline stroke | `#f0f0f0` |
| input line | `#e4e4e4` |
| font | Satoshi 500 body / 700 headings |

- Radii: 18 px cards, 12 px buttons, 8 px inputs.
- **No shadows.** Depth comes from fills and hairlines, as on the site.
- Buttons are 52 px with a hover `opacity-90` and a 2 px offset focus ring. The primary attendance CTA gets 64 px.
- Easing is `cubic-bezier(.4,0,.2,1)` at 150–200 ms.
- Brand gradient `#2255DA → #00D9F2`, from the logo, is used only for brand moments such as the login hero or the QR poster.
- Semantic success, warning and danger colors are added and AA-checked. The site's orange `#ec612a` fails contrast as text, so a darker shade is used for text. Every status also carries an icon and a text label, never color alone.
- Everything lives in `globals.css` `@theme` (colors, font, a 4 px-base spacing scale, radii, motion durations). `docs/design-system.md` documents it.
- **Page transitions:** React 19.3 `<ViewTransition>` on each page. The old page fades out 200 ms and then the new page fades in 200 ms. Durations are disabled under `prefers-reduced-motion`. Unsupported browsers swap instantly.
- Light theme only in v1, matching the site.

## 19. Automated testing

- **pgTAP (`supabase test db`):**
  - schema, constraints and grants
  - RLS as anon, member, other member and admin
  - immutability (UPDATE, DELETE and TRUNCATE rejected for every role)
  - settings permissions
  - the `before_user_created` hook with payload fixtures: Google firstmate+hd ✓, gmail ✗, firstmate without hd per decision B, email admin ✓, email other ✗
  - `attendance_day()` across the Manila midnight boundary (16:00 UTC), and that the day is not the UTC date
  - Haversine fixtures and boundaries
  - the state machine: next action, duplicates blocked, clock-out-without-in blocked, yesterday's incomplete day leaves today at CLOCK_IN and is not modified
- **Vitest integration (real local Supabase over HTTP):**
  - concurrency: 10 parallel `record_attendance` calls produce exactly one CLOCK_IN
  - a retry returns `STATE_CHANGED`
  - unauthenticated calls are denied
  - a member can't update settings via PostgREST; an admin can
  - a browser-supplied `role` or geofence field has no effect
- **Vitest unit:** `safe-next`, zod schemas, the attendance UI reducer and message mapping (Clock In vs Clock Out wording), time and elapsed formatting in the org timezone with the process forced to `TZ=UTC`, and QR URL building.
- **Playwright E2E** against `next build && next start` + local Supabase:
  - Test users are seeded in local SQL, so the real Google OAuth step is replaced by an equivalent session login in a setup project.
  - The Google button's authorize URL is asserted to carry `redirect_to=/auth/callback?next=/attendance?source=qr` and `hd=firstmate.tech`.
  - The callback route is tested for code success, error and malicious `next`.
  - Geolocation is emulated for inside, outside, low accuracy, denied (grant nothing plus an init-script stub for determinism), unavailable and timeout.
  - `context.setOffline(true)` checks that no fake success appears and that nothing is queued.

## 20. Browser / mobile verification plan

- Playwright projects: iPhone SE (375×667), Pixel 7 (412×915), iPhone 15 Pro Max (430×932), one phone in landscape, and Desktop Chrome 1440×900.
- The full journey is scripted with screenshots of every state: QR URL → login → session → Attendance → Clock In → Checking location → success → Clocked In → Clock Out → Day complete.
- Also covered: every failure state, unconfigured (member and admin views), Admin settings on phone and desktop, map pin tap/drag, the QR screen, print emulation (`page.emulateMedia({ media: 'print' })`), reduced motion, and a `display-mode: standalone` emulation for the PWA layout.
- Automated assertions: no horizontal overflow (`scrollWidth ≤ innerWidth`), touch targets ≥44 px, the primary CTA within the first viewport, and axe accessibility checks (`@axe-core/playwright`, dev only).
- I'll inspect the screenshots myself and fix any issues. The built-in `run` skill will drive the real app.

## 21. Custom Claude skills (`.claude/skills/*/SKILL.md`)

1. `attendance-domain`
2. `geofence-validation`
3. `supabase-auth-security`
4. `firstmate-design`
5. `pwa-guardrails`
6. `admin-settings`
7. `verify-attendance` (runnable checklist: format → lint → typecheck → unit → db → integration → build → e2e → visual)
8. `vercel-deployment`

Each is concise and rule-focused. `CLAUDE.md` stays short: purpose, commands, trust-boundary rules, scope exclusions, and pointers to the skills.

Built-in capabilities available in this install: `run`, `code-review`, `simplify`, `security-review`, `init`, plus plan mode and subagents.
- Plan: `run` for launching and driving the app, `simplify` and `code-review` near the end, and `security-review` combined with a dedicated security-reviewer subagent.
- Also separate QA and UI/UX reviewer subagents.
- `/verify` and `/design-sync` are not installed as skills here, so I won't rely on them.

## 22. Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + local | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel + local | `sb_publishable_…` (new key model; legacy anon keys are being retired end-2026) |
| `NEXT_PUBLIC_SITE_URL` | Vercel + local | Canonical origin, used for the OAuth `redirectTo` and the QR URL (e.g. `https://attendance.firstmate.tech`). |
| `SUPABASE_SECRET_KEY` | **local/test only** | Used by tests to seed users. **Not set on Vercel.** |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` | local `supabase/.env` only (optional) | Only if you want to try real Google locally. In production they're entered in the Supabase dashboard. |

The org timezone is not an env var in the recommended design (see Open Question A).

## 23. External manual setup (I cannot do these without your credentials)

1. Create the Supabase project (or approve that I use the Supabase MCP if you connect one) and run `supabase link` + `supabase db push`.
2. In the Supabase dashboard:
   - enable the `before_user_created` hook
   - enable Google with its client ID and secret
   - set the Site URL and Redirect URLs
   - disable email sign-ups
3. In Google Cloud Console, create an OAuth client (Web). Set the authorized redirect URI to `https://<ref>.supabase.co/auth/v1/callback`, and make the consent screen **Internal** to the Workspace.
4. Create `admin@firstmate.tech` in Supabase Auth with a password-manager-generated password.
5. Create the Vercel project: 3 env vars, Node 24, and optionally a custom domain.
6. Production smoke test:
   - an Admin sets the office pin
   - you Clock In and Out on a real phone at the office
   - a gmail account is rejected
7. Print the QR code.

## 24. Risks

- **GPS accuracy indoors:** phones inside buildings often report 20–100 m, so 50 m may reject people. The threshold is Admin-tunable. Messages tell users to try near a window or outdoors.
- **iOS Safari (non-installed)** may re-prompt for location permission frequently. The installed PWA behaves better. This is documented in onboarding text.
- **Shifts crossing midnight (known limitation from the day rule):** someone who clocks in at 18:00 and tries to clock out at 00:30 is on a new attendance day, so they'll see Clock In. I'll document it rather than invent a rule.
- **Google `hd` claim:** Supabase stores `custom_claims.hd` from Google's ID token, but a legacy fallback path may omit it. If Open Question B is "require hd", the first real login must be verified in the smoke test.
- **Hooks aren't auto-deployed:** the `before_user_created` hook must be enabled in the hosted dashboard. The DB-level domain checks keep attendance safe even if someone forgets.
- **OpenFreeMap has no SLA.** It affects only the Admin map.
- **`on delete restrict`:** deleting a Supabase auth user who has attendance history will fail. That is intentional, because records are retained indefinitely.
- **Tooling:** the local machine runs Node 26. Vercel will run Node 24, and `engines` will be set to `>=22`. Two other local Supabase stacks are running, so this project uses ports 573xx.

## 25. Assumptions

- `admin@firstmate.tech` may or may not be a real Workspace mailbox. The design works either way.
- One office, in the Philippines (Asia/Manila), and v1 scope exactly as specified.
- No dark mode, no i18n (English only), and 24-hour time format ("09:04", as in the examples).
- The Google Sheet report is maintained outside the app. The app only links to it, from Admin Settings.
- The approved PDF mockups referenced in the brief were **not provided** in this repo. I'm working from the written states and the live site. Share them if you'd like them followed more closely.

---

## Open questions (need your decision)

**A. Where does the attendance timezone live?**
- **Recommended:** in a private DB config row, seeded `Asia/Manila`, changeable only by a one-line SQL statement (not by Admin, not in the UI). The DB computes the attendance day, so a single source there avoids any env/DB mismatch. It also lets the DB stay the trust boundary without the app holding a secret key.
- **Alternative:** a literal `ATTENDANCE_TIMEZONE` Vercel env var. This requires routing attendance writes through a server-only secret-key path that passes the timezone in, because the timezone must never come from the browser. It is more moving parts and puts a privileged key on Vercel.

**B. Require Google Workspace membership (`hd = firstmate.tech`) in addition to the email domain?**
- **Recommended: yes.** It blocks the edge case of a personal (non-Workspace) Google account registered with an `@firstmate.tech` address.
- Trade-off: if Supabase's Google claims ever omit `hd`, sign-up fails closed until fixed. The risk is low, and the smoke test catches it.
- The alternative is to check the email domain only.
