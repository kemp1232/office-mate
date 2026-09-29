"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/features/auth/dal";
import { getSheetSyncStatus, syncPendingToSheet, type SheetSyncStatus, type SyncOutcome } from "./sync";

/** Admin-only: push any queued attendance rows to the Google Sheet now. */
export async function syncSheetNowAction(): Promise<
  | { ok: true; outcome: SyncOutcome; status: SheetSyncStatus }
  | { ok: false; code: "FORBIDDEN" | "SERVER_ERROR" }
> {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "admin") return { ok: false, code: "FORBIDDEN" };
  try {
    // Drain the queue in batches (bounded so the request stays short).
    let outcome: SyncOutcome = await syncPendingToSheet({ limit: 50 });
    for (let i = 0; i < 4 && outcome.status === "done" && outcome.synced + outcome.failed === 50; i++) {
      outcome = await syncPendingToSheet({ limit: 50 });
    }
    const status = await getSheetSyncStatus(viewer.id);
    if (!status) return { ok: false, code: "FORBIDDEN" };
    revalidatePath("/admin/settings");
    return { ok: true, outcome, status };
  } catch (error) {
    console.error("[sheets] manual sync failed:", (error as Error).message);
    return { ok: false, code: "SERVER_ERROR" };
  }
}
