import { describe, expect, it } from "vitest";
import { formatDuration } from "@/features/attendance/format";
import type { ClockOutGate } from "@/features/attendance/types";
import {
  formValues,
  gateBadge,
  matchesSearch,
  memberName,
  ruleSummary,
  todaySummary,
} from "@/features/team/model";
import { memberInputSchema, type MemberFormValues } from "@/features/team/schema";

const form = (over: Partial<MemberFormValues> = {}): MemberFormValues => ({
  id: null,
  firstName: "Jessa Mae",
  lastName: "Abella",
  email: "jessaabella@firstmate.tech",
  ruleMode: "NONE",
  clockOutTime: "",
  requiredHours: "",
  ...over,
});

const errorsOf = (values: MemberFormValues) => {
  const r = memberInputSchema.safeParse(values);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path[0], i.message]));
};

describe("add / edit member form validation", () => {
  it("accepts a member and normalises their email", () => {
    const r = memberInputSchema.parse(
      form({ email: "  JessaAbella@FirstMate.tech ", firstName: " Jessa Mae " }),
    );
    expect(r).toEqual({
      id: null,
      firstName: "Jessa Mae",
      lastName: "Abella",
      email: "jessaabella@firstmate.tech",
      rule: { mode: "NONE" },
    });
  });

  it("only allows plain @firstmate.tech emails, never the Admin account", () => {
    expect(errorsOf(form({ email: "jessa@gmail.com" })).email).toMatch(/firstmate\.tech/);
    expect(errorsOf(form({ email: "jessa+x@firstmate.tech" })).email).toMatch(/firstmate\.tech/);
    expect(errorsOf(form({ email: "admin@firstmate.tech" })).email).toBe("That's the Admin account");
    expect(errorsOf(form({ email: "" })).email).toBe("Enter their email");
  });

  it("needs a first name; the last name is optional", () => {
    expect(errorsOf(form({ firstName: "  " })).firstName).toBe("Enter a first name");
    expect(memberInputSchema.safeParse(form({ lastName: "" })).success).toBe(true);
  });

  it("turns a fixed time or required hours into the stored rule", () => {
    expect(memberInputSchema.parse(form({ ruleMode: "TIME", clockOutTime: "18:00" })).rule).toEqual({
      mode: "TIME",
      clockOutTime: "18:00",
    });
    expect(memberInputSchema.parse(form({ ruleMode: "HOURS", requiredHours: "8.5" })).rule).toEqual({
      mode: "HOURS",
      requiredMinutes: 510,
    });
    // Values for the other rule types are ignored.
    expect(memberInputSchema.parse(form({ ruleMode: "NONE", requiredHours: "99" })).rule).toEqual({
      mode: "NONE",
    });
  });

  it("rejects a missing time and hours outside 0.5 to 16", () => {
    expect(errorsOf(form({ ruleMode: "TIME", clockOutTime: "" })).clockOutTime).toBe(
      "Choose a Clock Out time",
    );
    expect(errorsOf(form({ ruleMode: "TIME", clockOutTime: "24:00" })).clockOutTime).toBeDefined();
    expect(errorsOf(form({ ruleMode: "HOURS", requiredHours: "" })).requiredHours).toBe(
      "Enter the required hours",
    );
    expect(errorsOf(form({ ruleMode: "HOURS", requiredHours: "0.25" })).requiredHours).toBe(
      "Between 0.5 and 16 hours",
    );
    expect(errorsOf(form({ ruleMode: "HOURS", requiredHours: "17" })).requiredHours).toBeDefined();
  });

  it("only accepts the fields the form sends", () => {
    expect(memberInputSchema.safeParse({ ...form(), role: "admin" }).success).toBe(false);
  });
});

describe("team page display", () => {
  const gate = (over: Partial<ClockOutGate> = {}): ClockOutGate => ({
    status: "OPEN",
    opens_at: null,
    override: null,
    rule: null,
    ...over,
  });
  const member = (over: Record<string, unknown> = {}) => ({
    id: "00000000-0000-0000-0000-000000000001",
    firstName: "Kemp Steven",
    lastName: "Sayson",
    name: "Kemp Steven Sayson",
    email: "kempsayson@firstmate.tech",
    clockInAt: null as string | null,
    clockOutAt: null as string | null,
    clockOut: gate(),
    ...over,
  });
  const tz = "Asia/Manila";

  it("summarises the rule", () => {
    expect(ruleSummary(null)).toBe("No Clock Out rule");
    expect(ruleSummary({ mode: "TIME", clock_out_time: "18:00" })).toBe("Clock Out from 18:00");
    expect(ruleSummary({ mode: "HOURS", required_minutes: 510 })).toBe("8h 30m after Clock In");
    expect(formatDuration(540)).toBe("9h");
    expect(formatDuration(45)).toBe("45m");
  });

  it("summarises today and whether they can clock out", () => {
    expect(todaySummary(member(), tz)).toBe("Not clocked in");
    const inAt = "2026-10-01T00:58:00Z"; // 08:58 Manila
    expect(todaySummary(member({ clockInAt: inAt }), tz)).toBe("In 08:58 · Not out yet");
    expect(todaySummary(member({ clockInAt: inAt, clockOutAt: "2026-10-01T10:05:00Z" }), tz)).toBe(
      "In 08:58 · Out 18:05",
    );
    expect(gateBadge(member(), tz)).toBeNull();
    expect(
      gateBadge(
        member({ clockInAt: inAt, clockOut: gate({ status: "NOT_YET", opens_at: "2026-10-01T10:00:00Z" }) }),
        tz,
      ),
    ).toEqual({ tone: "neutral", label: "Clock Out opens 18:00" });
    expect(gateBadge(member({ clockInAt: inAt }), tz)).toEqual({
      tone: "success",
      label: "Can clock out now",
    });
    expect(gateBadge(member({ clockOut: gate({ status: "LOCKED", override: "LOCKED" }) }), tz)?.label).toBe(
      "Clock Out locked today",
    );
  });

  it("prefills the edit form from the saved rule", () => {
    expect(
      formValues(member({ clockOut: gate({ rule: { mode: "HOURS", required_minutes: 510 } }) })),
    ).toMatchObject({
      ruleMode: "HOURS",
      requiredHours: "8.5",
      clockOutTime: "",
    });
    expect(formValues()).toMatchObject({ id: null, ruleMode: "NONE", email: "" });
  });

  it("searches by name or email, ignoring case and accents", () => {
    expect(matchesSearch(member(), "SAYSON")).toBe(true);
    expect(matchesSearch(member({ name: "José Maglaque" }), "jose")).toBe(true);
    expect(matchesSearch(member(), "kempsayson@")).toBe(true);
    expect(matchesSearch(member(), "nobody")).toBe(false);
    expect(memberName(member({ name: " " }))).toBe("kempsayson@firstmate.tech");
  });
});
