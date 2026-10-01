import "server-only";
import { z } from "zod";
import { clockOutGateSchema } from "@/features/attendance/types";
import { callJson } from "@/lib/db";
import { env } from "@/lib/env";
import type { MemberInput, OverrideChoice } from "./schema";

/**
 * Admin team management over the database trust boundary (app.admin_team, admin_save_member,
 * admin_set_clock_out_override, admin_set_member_active). Every function re-checks the Admin in
 * SQL; "today" is the attendance day in the server's ATTENDANCE_TIMEZONE.
 */

const memberRowSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  name: z.string(),
  email: z.string(),
  signed_in: z.boolean(),
  deactivated_at: z.string().nullable(),
  clock_in_at: z.string().nullable(),
  clock_out_at: z.string().nullable(),
  clock_out: clockOutGateSchema,
});

const teamSchema = z.object({ ok: z.literal(true), day: z.string(), members: z.array(memberRowSchema) });

export type TeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  /** Has signed in with Google at least once (their email is then fixed). */
  signedIn: boolean;
  deactivatedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockOut: z.infer<typeof clockOutGateSchema>;
};

export type Team = { day: string; timezone: string; members: TeamMember[] };

/** Everyone except the Admin account. Null for non-admins. */
export async function getTeam(adminUserId: string): Promise<Team | null> {
  const timezone = env().ATTENDANCE_TIMEZONE;
  const raw = await callJson<{ ok: boolean }>("select app.admin_team($1::uuid, $2) as result", [
    adminUserId,
    timezone,
  ]);
  if (raw.ok !== true) return null;
  const team = teamSchema.parse(raw);
  return {
    day: team.day,
    timezone,
    members: team.members.map((m) => ({
      id: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      name: m.name,
      email: m.email,
      signedIn: m.signed_in,
      deactivatedAt: m.deactivated_at,
      clockInAt: m.clock_in_at,
      clockOutAt: m.clock_out_at,
      clockOut: m.clock_out,
    })),
  };
}

export type SaveMemberDbResult = { ok: true; id: string } | { ok: false; code: string; field?: string };

export async function saveMember(adminUserId: string, input: MemberInput): Promise<SaveMemberDbResult> {
  const { rule } = input;
  return callJson<SaveMemberDbResult>(
    "select app.admin_save_member($1::uuid, $2::uuid, $3, $4, $5, $6, $7::time, $8::integer) as result",
    [
      adminUserId,
      input.id,
      input.firstName,
      input.lastName,
      input.email,
      rule.mode,
      rule.mode === "TIME" ? rule.clockOutTime : null,
      rule.mode === "HOURS" ? rule.requiredMinutes : null,
    ],
  );
}

export async function setClockOutOverride(
  adminUserId: string,
  memberId: string,
  choice: OverrideChoice,
): Promise<{ ok: boolean; code?: string }> {
  return callJson("select app.admin_set_clock_out_override($1::uuid, $2::uuid, $3, $4) as result", [
    adminUserId,
    memberId,
    choice,
    env().ATTENDANCE_TIMEZONE,
  ]);
}

export async function setMemberActive(
  adminUserId: string,
  memberId: string,
  active: boolean,
): Promise<{ ok: boolean; code?: string }> {
  return callJson("select app.admin_set_member_active($1::uuid, $2::uuid, $3) as result", [
    adminUserId,
    memberId,
    active,
  ]);
}
