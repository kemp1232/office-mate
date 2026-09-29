---
name: pwa-guardrails
description: PWA/installability rules that keep attendance online-only. Use before touching the manifest, icons, service worker, viewport or offline behaviour.
---

# PWA guardrails

## Installability

- `src/app/manifest.ts`: name "First Mate Attendance", short_name "Attendance", `start_url /attendance`,
  `display standalone`, theme/background `#f9f9f9`, icons 192/512 + maskable 512 (`public/icons/`).
- Apple: `src/app/apple-icon.png` + `metadata.appleWebApp`. Regenerate icons: `node scripts/generate-icons.mjs`.
- Viewport: `viewportFit: "cover"`, `themeColor`; zoom stays enabled (accessibility).
- HTTPS comes from Vercel (geolocation requires a secure context; localhost is exempt).

## Service worker (`public/sw.js`, registered in production only)

- Handles ONLY `GET` + `request.mode === "navigate"`, and only to show `/offline.html` when the network fails.
- NEVER cache or replay POSTs, Server Actions, RSC payloads, `/api/auth/*`, or attendance data.
- NEVER add Background Sync, Periodic Sync, IndexedDB queues, or offline Clock In/Out.
- Bump the cache name when `offline.html` changes.

## Offline behaviour

- The Attendance screen checks `navigator.onLine` before asking for location and treats any failed
  request as "No connection – try again". Nothing is stored for later; the user retries manually.
- Retry first re-reads server state (`refreshStateAction`) so a request that did reach the server is shown.

## Layout in standalone mode

Safe-area utilities (`pt-safe`, `pb-safe`), `min-h-dvh`, sticky header with `backdrop-blur`, bottom
actions padded by `env(safe-area-inset-bottom)`.
