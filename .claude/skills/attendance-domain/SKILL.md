---
name: attendance-domain
description: Authoritative Clock In / Clock Out business rules — state machine, one-per-day, attendance day timezone, server-derived next action, immutability. Use before touching attendance SQL, services, actions or the Attendance screen.
---

# Attendance domain rules

## State machine (per user, per attendance day)

| Today's events       | next_action    | UI                          |
| -------------------- | -------------- | --------------------------- |
| none                 | `CLOCK_IN`     | Clock In (primary)          |
| CLOCK_IN             | `CLOCK_OUT`    | Clocked-in card + Clock Out |
| CLOCK_IN + CLOCK_OUT | `DAY_COMPLETE` | Summary, no action button   |

- At most ONE Clock In and ONE Clock Out per user per day: `unique (user_id, attendance_day, event_type)`.
- A Clock Out requires an earlier Clock In on the same day (trigger `require_clock_in_before_clock_out`).
- The **server derives the action** in `app.record_attendance`. The client's `expectedAction` is only a
  precondition: mismatch → `STATE_CHANGED` + real state, nothing written. This makes double taps and
  network retries safe. Never add an API that accepts an event type as an instruction.
- Concurrency: `pg_advisory_xact_lock(user, day)`, then `clock_timestamp()` taken **after** the lock.

## Who clocks

Active Team Members only. The Admin account and deactivated members are refused by
`app.team_member_email` (used by `record_attendance` and `get_attendance_state`) and by `clockAction`;
the Admin reviews attendance at `/admin/attendance`.

## Clock Out gate (rules + today's override)

- `app.clock_out_rules`: at most one rule per member, same every office day — `TIME` (earliest Clock Out,
  org timezone, whole minutes) or `HOURS` (`required_minutes` 30–960 after that day's Clock In).
- `app.clock_out_overrides`: keyed by `(user_id, attendance_day)` — `LOCKED` or `UNLOCKED` for today only.
- `app.clock_out_gate(user, day, tz, clock_in, now)` → `{status OPEN|NOT_YET|LOCKED, opens_at, override, rule}`.
  Order: LOCKED override → UNLOCKED override → no rule (OPEN) → before `opens_at` (NOT_YET) → OPEN.
- `record_attendance` checks it for Clock Out under the per-user/day lock with the trusted timestamp,
  after the location checks: `CLOCK_OUT_LOCKED` / `CLOCK_OUT_TOO_EARLY` (+ `opens_at`, + state); nothing written.
- Every state payload has `clock_out` (via `app.member_state`). The phone only mirrors it: disabled
  "Clock Out at HH:MM" / "Clock Out locked", no location request, and a re-read when `opens_at` passes.

## Attendance day

- `attendance_day = (clock_timestamp() at time zone ATTENDANCE_TIMEZONE)::date` via `app.attendance_day()`.
- `ATTENDANCE_TIMEZONE` is a server env var (default `Asia/Manila`), passed by `features/attendance/service.ts`.
  Never read it from the client, never use the host/Vercel timezone (UTC), never make it Admin-editable.
- UI formats times with `Intl.DateTimeFormat({ timeZone })` using the timezone returned in the state.

## Forgotten Clock Out

- Yesterday's lone Clock In stays exactly as recorded. No automatic Clock Out, no edits.
- Today starts fresh at `CLOCK_IN`.
- Known limitation: a shift crossing midnight can't clock out after midnight (new day). Document, don't "fix".

## Immutability (v1)

- Rows are inserted only by `app.record_attendance`. Triggers block UPDATE/DELETE/TRUNCATE for every role;
  `attendance_app` has no table privileges; users with history can't be deleted (`on delete restrict`).
- There is NO correction, deletion, or retention workflow for events. Don't build one. (The Clock Out
  override above only controls whether a Clock Out may be recorded; it never changes rows.)

## Each event stores

User id, email snapshot, type, attendance day, DB timestamp, submitted lat/lng/accuracy, computed distance,
the office lat/lng + radius + threshold it was checked against, `geofence_result = 'PASS'`, source (DIRECT/QR).
Failed attempts are not stored.

## Tests to update when changing rules

`supabase/tests/database/03_record_attendance.sql`, `supabase/tests/database/05_team_and_clock_out.sql`,
`tests/integration/attendance-db.test.ts`, `tests/unit/attendance-model.test.ts`, `tests/e2e/journey.spec.ts`,
`tests/e2e/team.spec.ts`.
