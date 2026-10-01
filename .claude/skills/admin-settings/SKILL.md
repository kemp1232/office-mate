---
name: admin-settings
description: Scope and rules for the Admin area (office map pin, radius, accuracy threshold, report link, QR). Use before changing anything under /admin.
---

# Admin area (v1 scope)

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
   It is also the **sync target**: every Clock In/Out is mirrored there (one tab per office day, Name / Email /
   Time in / Time out — `features/sheets`, `docs/google-sheets-sync.md`). The "Google Sheet sync" card shows
   status + the service-account email to share with, and has **Sync now**.

Validation lives in `features/settings/schema.ts` (field errors shown next to inputs) and DB check constraints.

## Attendance log (`/admin/attendance`, the Admin's home)

- Read-only. "Office day" `<select>` at the top lists every day with events (newest first, default the
  latest; `?day=YYYY-MM-DD`). One row per person: name (email if no name), Clock in, Clock out.
- Data: `app.admin_office_days` / `app.admin_day_attendance` (Admin re-checked in SQL). Stacked rows on
  phones, a table from `sm`.
- The Admin never clocks in/out: `/attendance` redirects here; `clockAction` + `app.record_attendance`
  (via `team_member_email`) refuse the Admin.

## Team (`/admin/team`, `/admin/team/new`, `/admin/team/[id]`)

- Everyone except the Admin (`app.admin_team`), searchable, deactivated hidden behind "Show deactivated".
  Each person: name, email, "Not signed in yet", Clock Out rule, today's times + gate badge, and a
  **Clock Out today** control (Follow rule / Unlock / Lock — today only, `app.admin_set_clock_out_override`).
- Add / edit (`app.admin_save_member`): first + last name, `@firstmate.tech` email (fixed after their first
  sign in), rule = none | fixed time | required hours. Validated in `features/team/schema.ts` and SQL.
- Deactivate / reactivate on the edit page (confirm step; `app.admin_set_member_active`).
- Code: `features/team/{schema,model,service,actions}.ts` + `team-list`, `override-control`,
  `member-form`, `member-access` components.

## QR (`/admin/qr`)

One static QR (qrcode.react SVG) for `${BETTER_AUTH_URL}/attendance?source=qr`, plus a print layout
(`print:` utilities). It is a shortcut only — not authentication, not a location proof, never auto-clocks.

## Not allowed

Charts/analytics/exports, editing or deleting attendance, role management (Admin stays the hard-coded
allow-list), deleting members, per-weekday schedules, multiple offices, reading data back from the
Sheet. Suggest these as v2 in docs instead.
