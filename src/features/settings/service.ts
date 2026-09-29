import "server-only";
import { callJson } from "@/lib/db";
import type { AdminSettings, SettingsInput } from "./schema";

type Row = {
  ok: boolean;
  code?: string;
  office_latitude: number | null;
  office_longitude: number | null;
  radius_m: number;
  accuracy_threshold_m: number;
  report_url: string;
  updated_at: string;
};

const toSettings = (r: Row): AdminSettings => ({
  officeLatitude: r.office_latitude,
  officeLongitude: r.office_longitude,
  radiusM: r.radius_m,
  accuracyThresholdM: r.accuracy_threshold_m,
  reportUrl: r.report_url,
  updatedAt: r.updated_at,
});

/** Admin is re-checked inside app.get_admin_settings(); returns null for non-admins. */
export async function getAdminSettings(userId: string): Promise<AdminSettings | null> {
  const r = await callJson<Row>("select app.get_admin_settings($1::uuid) as result", [userId]);
  return r.ok ? toSettings(r) : null;
}

export async function updateAdminSettings(
  userId: string,
  input: SettingsInput,
): Promise<{ ok: true; settings: AdminSettings } | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" }> {
  const r = await callJson<Row>("select app.update_admin_settings($1::uuid, $2, $3, $4, $5, $6) as result", [
    userId,
    input.officeLatitude,
    input.officeLongitude,
    input.radiusM,
    input.accuracyThresholdM,
    input.reportUrl,
  ]);
  if (r.ok) return { ok: true, settings: toSettings(r) };
  return { ok: false, code: r.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID_INPUT" };
}
