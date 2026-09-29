import "server-only";
import { callJson } from "@/lib/db";

/** Read-only attendance log for the Admin (Admin is re-checked inside SQL). */

export type LogRow = { name: string; email: string; clockInAt: string | null; clockOutAt: string | null };

/** Every office day (a day with at least one clock event), newest first. Null for non-admins. */
export async function getOfficeDays(adminUserId: string): Promise<string[] | null> {
  const r = await callJson<{ ok: boolean; days?: string[] }>(
    "select app.admin_office_days($1::uuid) as result",
    [adminUserId],
  );
  return r.ok ? (r.days ?? []) : null;
}

/** One row per person for an office day. Null for non-admins. */
export async function getDayAttendance(adminUserId: string, day: string): Promise<LogRow[] | null> {
  const r = await callJson<{
    ok: boolean;
    rows?: { name: string; email: string; clock_in_at: string | null; clock_out_at: string | null }[];
  }>("select app.admin_day_attendance($1::uuid, $2::date) as result", [adminUserId, day]);
  if (!r.ok) return null;
  return (r.rows ?? []).map((row) => ({
    name: row.name,
    email: row.email,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
  }));
}

/** What the log shows for a person: their name, or their email when there's no name. */
export function displayName(row: Pick<LogRow, "name" | "email">): string {
  return row.name.trim() || row.email;
}
