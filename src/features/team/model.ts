import { formatClockTime, formatDuration } from "@/features/attendance/format";
import type { ClockOutGate } from "@/features/attendance/types";
import type { MemberFormValues, OverrideChoice } from "./schema";

/** Pure display rules for the Admin team page (no I/O). Times are in the org timezone. */

type MemberLike = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockOut: ClockOutGate;
};

export function memberName(m: Pick<MemberLike, "name" | "email">): string {
  return m.name.trim() || m.email;
}

/** "Clock Out from 18:00" / "9h after Clock In" / "No Clock Out rule". */
export function ruleSummary(rule: ClockOutGate["rule"]): string {
  if (!rule) return "No Clock Out rule";
  return rule.mode === "TIME"
    ? `Clock Out from ${rule.clock_out_time}`
    : `${formatDuration(rule.required_minutes)} after Clock In`;
}

/** "In 08:58 · Out 18:05", "In 08:58 · Not out yet", or "Not clocked in". */
export function todaySummary(m: MemberLike, timezone: string): string {
  if (!m.clockInAt) return "Not clocked in";
  const out = m.clockOutAt ? `Out ${formatClockTime(m.clockOutAt, timezone)}` : "Not out yet";
  return `In ${formatClockTime(m.clockInAt, timezone)} · ${out}`;
}

export type GateBadge = { tone: "neutral" | "success" | "warning"; label: string };

/** Whether they can clock out right now, for people who are clocked in (or have an override). */
export function gateBadge(m: MemberLike, timezone: string): GateBadge | null {
  const { status, override, opens_at: opensAt } = m.clockOut;
  const clockedIn = Boolean(m.clockInAt) && !m.clockOutAt;
  if (override === "LOCKED") return { tone: "warning", label: "Clock Out locked today" };
  if (override === "UNLOCKED") return { tone: "success", label: "Clock Out unlocked today" };
  if (!clockedIn) return null;
  if (status === "NOT_YET")
    return {
      tone: "neutral",
      label: opensAt ? `Clock Out opens ${formatClockTime(opensAt, timezone)}` : "Clock Out not open yet",
    };
  return { tone: "success", label: "Can clock out now" };
}

export function overrideChoice(gate: ClockOutGate): OverrideChoice {
  return gate.override ?? "FOLLOW_RULE";
}

/** Initial values for the edit form (or a blank form for a new member). */
export function formValues(m?: MemberLike): MemberFormValues {
  const rule = m?.clockOut.rule ?? null;
  return {
    id: m?.id ?? null,
    firstName: m?.firstName ?? "",
    lastName: m?.lastName ?? "",
    email: m?.email ?? "",
    ruleMode: rule?.mode ?? "NONE",
    clockOutTime: rule?.mode === "TIME" ? rule.clock_out_time : "",
    requiredHours: rule?.mode === "HOURS" ? String(rule.required_minutes / 60) : "",
  };
}

/** Case- and accent-insensitive match on name or email for the team search box. */
export function matchesSearch(m: Pick<MemberLike, "name" | "email">, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const q = fold(query.trim());
  return q === "" || fold(m.name).includes(q) || fold(m.email).includes(q);
}
