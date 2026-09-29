---
name: geofence-validation
description: Rules for any location / geofence work — when location may be requested, validation order, defaults, server-side distance. Use before touching geolocation code, record_attendance, or settings limits.
---

# Geofence validation

## When location is requested

- ONLY inside the Clock In / Clock Out tap handler (and the Admin's explicit "Use my location" button).
- Exactly one `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })`
  per tap (`features/attendance/geolocation.ts`).
- Never `watchPosition`, never on page load, never polling, never background, never in the service worker.
- Never log coordinates; never send them to analytics. They are stored only in the attendance event.

## Server-side validation order (`app.record_attendance`)

1. authenticated user id
2. verified `@firstmate.tech` account
3. office configured (else `NOT_CONFIGURED`)
4. finite lat ∈ [-90,90], lng ∈ [-180,180], 0 < accuracy ≤ 100000 (NaN/Infinity rejected)
5. **accuracy > threshold → `ACCURACY_TOO_LOW`** (before any distance check)
6. Haversine distance (R = 6,371,008.8 m)
7. distance > radius → `OUTSIDE_GEOFENCE`
8. per-user/day advisory lock, then derive the next action
9. insert with `clock_timestamp()`

Boundaries: `accuracy ≤ threshold` passes; `distance ≤ radius` passes.

## Configuration

- ONE office for the organisation (singleton `app.attendance_settings`). No branches/per-user offices.
- Defaults: radius **300 m** (10–5000), accuracy threshold **50 m** (5–1000; the team may raise to 300 m indoors).
- Office starts **unconfigured** → `NOT_CONFIGURED`, UI "Attendance isn't set up yet".
- Coordinates, radius and threshold come only from the database — never from the request.

## Trust

- The browser never sends distance, inside/outside, or timestamps; `clockInputSchema` is `.strict()`.
- No advanced anti-spoofing in v1 (no attestation, IP/VPN checks, Wi-Fi/Bluetooth). Don't add it.

## Copy (features/attendance/messages.ts)

"Checking your location…", "You're at the office · Verified · 12m accuracy", "Outside the office area ·
420m away · limit 300m", "A more accurate location is needed – try again outdoors", "Location access is
required to clock in/out", "No connection – try again", "Attendance isn't set up yet".
