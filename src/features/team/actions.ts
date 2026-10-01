"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/features/auth/dal";
import {
  memberInputSchema,
  OVERRIDE_CHOICES,
  type MemberActionResult,
  type MemberFieldErrors,
  type SaveMemberResult,
} from "./schema";
import { saveMember, setClockOutOverride, setMemberActive } from "./service";

/** Admin-only. Authorised here (verified session + allow-list) and again in the database. */

async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.role === "admin" ? viewer : null;
}

const DB_FIELD_ERRORS: Record<string, MemberFieldErrors> = {
  EMAIL_TAKEN: { email: "Someone on the team already uses this email" },
  EMAIL_LOCKED: { email: "They've already signed in with this email, so it can't change" },
};

export async function saveMemberAction(raw: unknown): Promise<SaveMemberResult> {
  const viewer = await requireAdmin();
  if (!viewer) return { ok: false, code: "FORBIDDEN" };

  const parsed = memberInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: MemberFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof MemberFieldErrors | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, code: "INVALID_INPUT", fieldErrors };
  }

  try {
    const result = await saveMember(viewer.id, parsed.data);
    if (result.ok) {
      revalidatePath("/admin/team");
      return { ok: true, id: result.id };
    }
    if (result.code in DB_FIELD_ERRORS)
      return { ok: false, code: "INVALID_INPUT", fieldErrors: DB_FIELD_ERRORS[result.code] };
    if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") return { ok: false, code: result.code };
    return { ok: false, code: "INVALID_INPUT" };
  } catch (error) {
    console.error("[team] save failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}

const overrideSchema = z.object({ memberId: z.uuid(), choice: z.enum(OVERRIDE_CHOICES) }).strict();

/** Lock or unlock a member's Clock Out for today, or return them to their rule. */
export async function setClockOutOverrideAction(raw: unknown): Promise<MemberActionResult> {
  const viewer = await requireAdmin();
  if (!viewer) return { ok: false, code: "FORBIDDEN" };
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "NOT_FOUND" };
  try {
    const result = await setClockOutOverride(viewer.id, parsed.data.memberId, parsed.data.choice);
    if (!result.ok) return { ok: false, code: result.code === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND" };
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("[team] override failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}

const activeSchema = z.object({ memberId: z.uuid(), active: z.boolean() }).strict();

/** Deactivate (signs them out, blocks sign in and clocking) or reactivate a member. */
export async function setMemberActiveAction(raw: unknown): Promise<MemberActionResult> {
  const viewer = await requireAdmin();
  if (!viewer) return { ok: false, code: "FORBIDDEN" };
  const parsed = activeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "NOT_FOUND" };
  try {
    const result = await setMemberActive(viewer.id, parsed.data.memberId, parsed.data.active);
    if (!result.ok) return { ok: false, code: result.code === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND" };
    revalidatePath("/admin/team");
    refresh();
    return { ok: true };
  } catch (error) {
    console.error("[team] activation change failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}
