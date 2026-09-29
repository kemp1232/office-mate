"use server";

import { after } from "next/server";
import { syncPendingToSheet } from "@/features/sheets/sync";
import { getViewer } from "@/features/auth/dal";
import { getTodayState, recordAttendance } from "./service";
import { clockInputSchema, type AttendanceState, type ClockResult } from "./types";

/**
 * The single attendance mutation. The browser supplies only coordinates, accuracy, source
 * and the action it was showing (a precondition). Identity comes from the verified session;
 * everything else is decided in the database.
 */
export async function clockAction(raw: unknown): Promise<ClockResult> {
  try {
    const viewer = await getViewer();
    if (!viewer) return { ok: false, code: "UNAUTHENTICATED" };
    if (viewer.role === "admin") return { ok: false, code: "FORBIDDEN" }; // Admins don't clock (SQL agrees)

    const parsed = clockInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };

    const result = await recordAttendance(viewer.id, parsed.data);
    // Mirror to the report Google Sheet after the response is sent — never blocks or fails a clock.
    if (result.ok)
      after(() => syncPendingToSheet().catch((e: Error) => console.error("[sheets]", e.message)));
    return result;
  } catch (error) {
    // Never log coordinates.
    console.error("[attendance] record failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}

/** Re-reads today's authoritative state (used after a failed request to resync). */
export async function refreshStateAction(): Promise<AttendanceState | null> {
  const viewer = await getViewer();
  if (!viewer) return null;
  return getTodayState(viewer.id);
}
