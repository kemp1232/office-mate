---
name: admin-settings
description: Scope and rules for the Admin area (office map pin, radius, accuracy threshold, report link, QR). Use before changing anything under /admin.
---

# Admin settings (v1 scope)

Admin = `admin@firstmate.tech` only. Pages call `requireAdminPage()`; `saveSettingsAction` re-checks the
role; SQL `app.update_admin_settings` checks `app.is_admin` again.

## Exactly four settings (`app.attendance_settings` singleton)

1. **Office location** — one pin on a MapLibre map (`features/settings/office-map.tsx`). Tap to place,
   drag to move, "Use my location" (explicit tap). Coordinates shown read-only; no manual coordinate entry.
   Map: MapLibre GL v6 + react-map-gl + OpenFreeMap "liberty" (free, no key, commercial OK; attribution
   auto). Worker served from `/public/vendor/maplibre` (copied by `postinstall`). `cooperativeGestures` on.
2. **Geofence radius** — metres, default 300, 10–5000.
3. **Accuracy threshold** — metres, default 50, 5–1000.
4. **Report link** — https URL, default the team Google Sheet. "Open report" opens it in a new tab. Admin-only.

Validation lives in `features/settings/schema.ts` (field errors shown next to inputs) and DB check constraints.

## QR (`/admin/qr`)

One static QR (qrcode.react SVG) for `${BETTER_AUTH_URL}/attendance?source=qr`, plus a print layout
(`print:` utilities). It is a shortcut only — not authentication, not a location proof, never auto-clocks.

## Not allowed

Attendance tables/reports/dashboards/exports, editing or deleting attendance, user or role management,
multiple offices, Sheets sync. Suggest these as v2 in docs instead.
