# Future: one-way PostgreSQL → Google Sheets sync (NOT implemented in v1)

v1 keeps Postgres as the only attendance datastore; the Admin Settings "Report link" just opens an
externally maintained Google Sheet. This note sketches a later, one-way export.

## Shape

- Direction: **Postgres → Sheet only.** The Sheet is a read-only mirror; nothing flows back.
- Trigger: a scheduled job (Vercel Cron every 5–15 min, or a Supabase `pg_cron` + Edge Function).
- Source: `app.attendance_events` ordered by `recorded_at`, keyed by `id` (uuid) so appends are idempotent.
- Cursor: a small `app.sheet_sync_state (last_recorded_at, last_id)` row updated after each successful
  append. Re-running after a failure appends only missing rows.
- Columns: date (attendance_day), email, event type, time (in `ATTENDANCE_TIMEZONE`), accuracy (m),
  distance (m), radius at the time, source, event id.

## Auth

A Google Cloud service account with the Sheets API enabled; share the target Sheet with the service
account's email (Editor). Store its key as a server-only secret. Use `spreadsheets.values.append` with
`valueInputOption=RAW`.

## Guardrails

- Never write coordinates to the Sheet unless the business explicitly needs them (privacy).
- The job runs as a separate DB role with `SELECT` on `attendance_events` only.
- The Sheet is not authoritative; disputes are resolved from Postgres.
