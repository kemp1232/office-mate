"use client";

import { useState } from "react";
import { CircleAlert, CircleCheckBig, RefreshCw, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { syncSheetNowAction } from "./actions";
import type { SheetSyncStatus } from "./sync";

/** Admin view of the Postgres → Google Sheet export (one tab per office day). */
export function SheetSyncCard({ initial }: { initial: SheetSyncStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  async function syncNow() {
    if (pending) return;
    setPending(true);
    setMessage(undefined);
    try {
      const result = await syncSheetNowAction();
      if (!result.ok) setMessage("Couldn't sync right now. Try again.");
      else {
        setStatus(result.status);
        const o = result.outcome;
        setMessage(
          o.status === "disabled"
            ? "Sync isn't set up yet, so nothing was sent."
            : o.failed
              ? `Synced ${o.synced}, ${o.failed} failed.`
              : o.synced
                ? `Synced ${o.synced} ${o.synced === 1 ? "row" : "rows"}.`
                : "Everything is already up to date.",
        );
      }
    } catch {
      setMessage("You're offline. Check your connection and try again.");
    }
    setPending(false);
  }

  const ready = status.configured && status.spreadsheetConfigured;
  const healthy = ready && status.failing === 0;
  const StatusIcon = healthy ? CircleCheckBig : CircleAlert;

  return (
    <Card aria-labelledby="sheet-sync-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="sheet-sync-heading" className="flex items-center gap-2 text-lg">
          <Sheet aria-hidden className="size-5 shrink-0 text-accent" />
          Google Sheet sync
        </h2>
        <p
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-button px-3 py-1 text-sm font-bold ${
            healthy ? "bg-success-tint text-success" : "bg-warning-tint text-warning"
          }`}
        >
          <StatusIcon aria-hidden className="size-4 shrink-0" />
          {!status.configured
            ? "Not set up yet"
            : !status.spreadsheetConfigured
              ? "The report link isn't a Google Sheet"
              : status.failing
                ? `${status.failing} ${status.failing === 1 ? "row" : "rows"} failing`
                : status.pending
                  ? `${status.pending} waiting to sync`
                  : "Up to date"}
        </p>
      </div>

      <p className="text-sm text-ink-muted">
        Every Clock In and Clock Out is added to the report Sheet automatically. Each office day gets its own
        tab (for example “October 13, 2026”) with Name, Email, Time in and Time out.
        {!status.configured ? (
          <>
            {" "}
            Sync isn&apos;t connected yet. Clock ins are still saved, and they&apos;ll be added to the Sheet
            once it is.
          </>
        ) : null}
      </p>

      {status.lastError && status.failing ? (
        <p className="rounded-panel bg-warning-tint px-4 py-3 text-sm text-ink">
          Last error: {status.lastError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-stroke pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-ink-muted">
            <strong className="text-ink">Sync now</strong> is a manual backup. You only need it if the Sheet
            doesn&apos;t match the Attendance log.
          </p>
          <p className="text-sm font-bold text-ink empty:hidden" aria-live="polite">
            {message}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={syncNow}
          aria-disabled={pending || !ready || undefined}
          icon={<RefreshCw aria-hidden className={`size-4 ${pending ? "animate-spin" : ""}`} />}
          className="shrink-0"
        >
          {pending ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </Card>
  );
}
