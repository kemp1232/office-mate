# Google Sheets sync (Postgres → Sheet, one way)

Every Clock In / Clock Out is mirrored into the Google Sheet set as the **Report link** in Admin
Settings. Postgres stays the source of truth; the Sheet is a readable copy.

## What the Sheet looks like

- **One tab per office day**, named by date — e.g. `September 10, 2026`, `October 14, 2026`. A tab is
  created the first time someone clocks in that day, placed first (newest day on the left), with a
  frozen header row.
- **One row per person** on that tab:

  | Name     | Email               | Time in | Time out |
  | -------- | ------------------- | ------- | -------- |
  | Jane Doe | jane@firstmate.tech | 09:04   | 17:32    |

  Clock In adds the row; Clock Out fills **Time out** on the same row. Times are 24-hour, in
  `ATTENDANCE_TIMEZONE` (Asia/Manila).

## How it works

1. `app.record_attendance` inserts the event. A trigger queues `(attendance_day, user)` in
   `app.sheet_sync` **in the same transaction**, so a committed event can never be missed.
2. After the response is sent (`after()` in the clock Server Action), the worker claims queued
   person-days (short lease, `FOR UPDATE SKIP LOCKED`), rewrites that person's whole row for the day from
   the database, and marks the synced version. Rewriting from the database makes retries idempotent; the
   version check means a Clock Out that arrives mid-sync is synced on the next run.
3. If Google is unreachable or the Sheet isn't shared, the row stays queued with the error. It retries on
   the next Clock In / Clock Out by anyone, or when the Admin taps **Sync now** in Settings.

Clock In / Clock Out never waits for Google and never fails because of it.

Code: `supabase/migrations/20260929000003_sheet_sync.sql`, `src/features/sheets/*`.

## Setup

1. Google Cloud Console (same project as the OAuth client is fine) → **APIs & Services → Library** →
   enable **Google Sheets API**.
2. **IAM & Admin → Service accounts → Create service account** (e.g. `office-mate-sheets`). No roles needed.
3. Open it → **Keys → Add key → JSON**. From the downloaded file take `client_email` and `private_key`.
4. Set env vars (Vercel + `.env.local`):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = `client_email`
   - `GOOGLE_SERVICE_ACCOUNT_KEY` = `private_key` exactly as in the file (with the `\n` escapes)
5. Open the report Google Sheet → **Share** → add the service-account email as **Editor**.
6. Admin Settings → **Google Sheet sync** should say "Up to date" (or tap **Sync now**).

If your Workspace blocks sharing with accounts outside the domain, allow this one service account (or
create it in a Google Cloud project owned by the firstmate.tech organisation).

## Guardrails

- Write-only: the app never reads attendance back from the Sheet; edits made in the Sheet don't affect
  the app (and may be overwritten for that person's row when they next clock).
- Only name, email and times are written — no coordinates or distances.
- The service account key is a server-only secret; never `NEXT_PUBLIC_`.
