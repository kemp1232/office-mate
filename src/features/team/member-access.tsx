"use client";

import { useState } from "react";
import { UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setMemberActiveAction } from "./actions";

/**
 * Deactivate (with a confirm step) or reactivate a member. Deactivating signs them out
 * everywhere and blocks sign in and clocking; their attendance history is kept.
 */
export function MemberAccess({
  memberId,
  memberName,
  deactivated,
}: {
  memberId: string;
  memberName: string;
  deactivated: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function apply(active: boolean) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await setMemberActiveAction({ memberId, active });
      if (!result.ok) setError("Couldn't save. Try again.");
      else setConfirming(false);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <Card aria-labelledby="access-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="access-heading" className="text-lg">
          Access
        </h2>
        <p className="text-sm text-ink-muted">
          {deactivated
            ? `${memberName} is deactivated. They can't sign in or clock in. Their attendance history is kept.`
            : `Deactivate someone who has left. They're signed out right away and can't sign in or clock in. Their attendance history is kept.`}
        </p>
      </div>

      {deactivated ? (
        <Button
          variant="secondary"
          onClick={() => apply(true)}
          aria-disabled={pending || undefined}
          icon={<UserCheck aria-hidden className="size-5" />}
          className="self-start"
        >
          {pending ? "Reactivating…" : "Reactivate"}
        </Button>
      ) : confirming ? (
        <div
          role="group"
          aria-label="Confirm deactivation"
          className="flex flex-col gap-3 rounded-panel bg-danger-tint p-4"
        >
          <p className="font-bold text-ink-strong">Deactivate {memberName}?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="danger"
              onClick={() => apply(false)}
              aria-disabled={pending || undefined}
              icon={<UserX aria-hidden className="size-5" />}
            >
              {pending ? "Deactivating…" : "Yes, deactivate"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setConfirming(true)}
          icon={<UserX aria-hidden className="size-5" />}
          className="self-start"
        >
          Deactivate
        </Button>
      )}

      <p role="status" aria-live="polite" className="text-sm font-bold text-danger empty:hidden">
        {error}
      </p>
    </Card>
  );
}
