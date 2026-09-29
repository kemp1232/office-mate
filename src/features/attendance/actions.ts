"use server";

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

    const parsed = clockInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };

    return await recordAttendance(viewer.id, parsed.data);
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
