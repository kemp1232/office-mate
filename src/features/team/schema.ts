import { z } from "zod";
import { isAdminEmail, isOrgEmail, normalizeEmail } from "@/features/auth/roles";

/** Required hours a member must spend in the office before Clock Out (same limits as SQL). */
export const REQUIRED_HOURS = { min: 0.5, max: 16, step: 0.25 } as const;

export type RuleMode = "NONE" | "TIME" | "HOURS";
export type ClockOutRule =
  { mode: "NONE" } | { mode: "TIME"; clockOutTime: string } | { mode: "HOURS"; requiredMinutes: number };

/** Today's Clock Out override, chosen by the Admin. It ends by itself at the next office day. */
export const OVERRIDE_CHOICES = ["FOLLOW_RULE", "UNLOCKED", "LOCKED"] as const;
export type OverrideChoice = (typeof OVERRIDE_CHOICES)[number];

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Add / edit member form. Validated again in SQL (app.admin_save_member). */
export const memberInputSchema = z
  .object({
    id: z.uuid().nullable(),
    firstName: z.string().trim().min(1, "Enter a first name").max(100, "Keep it under 100 characters"),
    lastName: z.string().trim().max(100, "Keep it under 100 characters"),
    email: z
      .string()
      .transform(normalizeEmail)
      .refine((e) => e.length > 0, "Enter their email")
      .refine((e) => e === "" || isOrgEmail(e), "Use their @firstmate.tech email")
      .refine((e) => !isAdminEmail(e), "That's the Admin account"),
    ruleMode: z.enum(["NONE", "TIME", "HOURS"]),
    clockOutTime: z.string(),
    requiredHours: z.string(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.ruleMode === "TIME" && !TIME_OF_DAY.test(v.clockOutTime))
      ctx.addIssue({ code: "custom", path: ["clockOutTime"], message: "Choose a Clock Out time" });
    if (v.ruleMode === "HOURS") {
      const hours = Number(v.requiredHours);
      if (v.requiredHours.trim() === "" || !Number.isFinite(hours))
        ctx.addIssue({ code: "custom", path: ["requiredHours"], message: "Enter the required hours" });
      else if (hours < REQUIRED_HOURS.min || hours > REQUIRED_HOURS.max)
        ctx.addIssue({
          code: "custom",
          path: ["requiredHours"],
          message: `Between ${REQUIRED_HOURS.min} and ${REQUIRED_HOURS.max} hours`,
        });
    }
  })
  .transform(({ id, firstName, lastName, email, ruleMode, clockOutTime, requiredHours }): MemberInput => ({
    id,
    firstName,
    lastName,
    email,
    rule:
      ruleMode === "TIME"
        ? { mode: "TIME", clockOutTime }
        : ruleMode === "HOURS"
          ? { mode: "HOURS", requiredMinutes: Math.round(Number(requiredHours) * 60) }
          : { mode: "NONE" },
  }));

export type MemberInput = {
  id: string | null;
  firstName: string;
  lastName: string;
  email: string;
  rule: ClockOutRule;
};
export type MemberFormValues = z.input<typeof memberInputSchema>;

export type MemberFieldErrors = Partial<
  Record<"firstName" | "lastName" | "email" | "clockOutTime" | "requiredHours", string>
>;

export type SaveMemberResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "SERVER_ERROR";
      fieldErrors?: MemberFieldErrors;
    };

export type MemberActionResult =
  { ok: true } | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "SERVER_ERROR" };
