"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/features/auth/dal";
import { settingsInputSchema, type SaveSettingsResult, type SettingsFieldErrors } from "./schema";
import { updateAdminSettings } from "./service";

/** Admin-only. Authorised here (verified session + allow-list) and again in the database. */
export async function saveSettingsAction(raw: unknown): Promise<SaveSettingsResult> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { ok: false, code: "FORBIDDEN" };

  const parsed = settingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: SettingsFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof SettingsFieldErrors | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, code: "INVALID_INPUT", fieldErrors };
  }

  try {
    const result = await updateAdminSettings(viewer.id, parsed.data);
    if (!result.ok) return { ok: false, code: result.code };
    revalidatePath("/admin/settings");
    revalidatePath("/attendance");
    return { ok: true, settings: result.settings };
  } catch (error) {
    console.error("[settings] save failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}
