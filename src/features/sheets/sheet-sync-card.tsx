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
            ? "Sync is off — see the setup note below."
            : o.failed
              ? `Synced ${o.synced}, ${o.failed} failed.`
              : o.synced
                ? `Synced ${o.synced} ${o.synced === 1 ? "row" : "rows"}.`
                : "Everything is already up to date.",
        );
      }
    } catch {
      setMessage("No connection – try again.");
    }
    setPending(false);
  }

  const ready = status.configured && status.spreadsheetConfigured;
  const healthy = ready && status.failing === 0;

  return (
    <Card aria-labelledby="sheet-sync-heading" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Sheet aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <h2 id="sheet-sync-heading" className="text-lg">
            Google Sheet sync
          </h2>
          <p className="text-sm text-ink-muted">
            Each Clock In / Clock Out is added to the report Sheet — one tab per office day (e.g. “October 13,
            2026”) with Name, Email, Time in and Time out.
          </p>
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm font-bold" role="status" aria-live="polite">
        {healthy ? (
          <CircleCheckBig aria-hidden className="size-4 text-success" />
        ) : (
          <CircleAlert aria-hidden className="size-4 text-warning" />
        )}
        <span className={healthy ? "text-success" : "text-warning"}>
          {!status.configured
            ? "Not set up yet"
            : !status.spreadsheetConfigured
              ? "The report link isn't a Google Sheet"
              : status.failing
                ? `${status.failing} ${status.failing === 1 ? "row" : "rows"} failing`
                : status.pending
                  ? `${status.pending} waiting to sync`
                  : "Up to date"}
        </span>
      </p>

      {status.lastError && status.failing ? (
        <p className="rounded-panel bg-warning-tint px-4 py-3 text-sm text-ink">
          Last error: {status.lastError}
        </p>
      ) : null}

      {status.serviceAccountEmail ? (
        <p className="text-sm text-ink-muted">
          Share the Sheet with{" "}
          <span className="font-bold break-all text-ink">{status.serviceAccountEmail}</span> as an{" "}
          <strong>Editor</strong>.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Add a Google service account (<code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and{" "}
          <code>GOOGLE_SERVICE_ACCOUNT_KEY</code>) to turn sync on. Clock-ins are queued until then.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={syncNow}
          aria-disabled={pending || !ready || undefined}
          icon={<RefreshCw aria-hidden className={`size-4 ${pending ? "animate-spin" : ""}`} />}
        >
          {pending ? "Syncing…" : "Sync now"}
        </Button>
        <p className="text-sm text-ink-muted" aria-live="polite">
          {message}
        </p>
      </div>
    </Card>
  );
}
