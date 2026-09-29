---
name: verify-attendance
description: Repeatable end-to-end verification of the Attendance app (static checks, DB, integration, build, device E2E, visual review). Use before declaring any change done.
---

# Verify the Attendance app

Prereqs: Docker running, `npm run db:start`, `.env.local` from `.env.example`. Port 3000 free (Playwright
builds and starts the production server itself; if a server is already on :3000 it is reused — stop stale ones).

## 1. Static

```bash
npm run format:check && npm run lint && npm run typecheck
```

## 2. Tests

```bash
npm test                  # unit: roles, safe redirects, reducer, copy, formatting (TZ=UTC), schemas
npm run test:db           # pgTAP: privileges, geofence/day, state machine, immutability, settings
npm run test:integration  # real Postgres: concurrency (10 parallel), retries, authz, Sheets sync queue + worker
npm run build
npm run test:e2e          # Playwright projects: iphone-se 320px, pixel-7, iphone-15-pro-max,
                          # phone-landscape, webkit-iphone (real WebKit), desktop 1440
```

`npm run verify` runs all of the above in order.

E2E coverage: QR → login → Clock In → Checking → verified → Clocked in → Clock Out → Day complete;
denied / unavailable / timeout / poor accuracy / outside / offline / mid-request drop / unconfigured /
double tap; Google redirect (hd, callback URI, PKCE, QR destination) + injected session; members refused
on the password endpoint; disabled sign-up/email endpoints; Google error copy; Admin password form; open redirect;
Team Member blocked from /admin; Admin map pin + save + validation; QR + print; manifest + SW guardrails;
layout (no overflow, 44px targets, axe, CTA in first viewport, reduced motion).

## 3. Visual review

Screenshots are written to `test-results/<test>/<name>.png` (and the HTML report: `npx playwright show-report`).
Look at every state on iphone-se, pixel-7, phone-landscape and desktop for: spacing, clipped CTAs,
overflow, contrast, brand consistency, safe areas, map usability.

## 4. Manual (real devices, can't be automated)

Real Google Workspace sign-in (needs the OAuth client); install the PWA on iOS Safari + Android Chrome,
clock in/out at the office with real GPS, check the permission prompt wording and standalone safe areas. If WebKit fails locally with a
`__libc_pthread_init` error, the shell has Snap GTK/GIO vars — `playwright.config.ts` strips them.
