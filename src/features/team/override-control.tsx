"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { setClockOutOverrideAction } from "./actions";
import type { OverrideChoice } from "./schema";

const OPTIONS: { value: OverrideChoice; label: string }[] = [
  { value: "FOLLOW_RULE", label: "Follow rule" },
  { value: "UNLOCKED", label: "Unlock" },
  { value: "LOCKED", label: "Lock" },
];

/**
 * Today's Clock Out override for one member: follow their rule, unlock (clock out any time), or
 * lock (can't clock out). Saved on change; resets by itself at the next office day.
 */
export function OverrideControl({
  memberId,
  memberName,
  value,
}: {
  memberId: string;
  memberName: string;
  value: OverrideChoice;
}) {
  const name = useId();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [error, setError] = useState<string>();

  function choose(choice: OverrideChoice) {
    if (choice === optimistic) return;
    setError(undefined);
    startTransition(async () => {
      setOptimistic(choice);
      try {
        const result = await setClockOutOverrideAction({ memberId, choice });
        if (!result.ok) setError("Couldn't save. Try again.");
      } catch {
        setError("You're offline. Check your connection and try again.");
      }
    });
  }

  return (
    <fieldset aria-busy={pending || undefined} className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-bold text-ink-muted lg:sr-only">
        Clock Out today<span className="sr-only"> for {memberName}</span>
      </legend>
      <div className="grid grid-cols-3 rounded-button border border-line bg-surface-muted p-0.5">
        {OPTIONS.map((option) => (
          <label key={option.value} className="relative min-w-0">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={optimistic === option.value}
              onChange={() => choose(option.value)}
              className="peer absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="flex min-h-(--touch-min) items-center justify-center rounded-[calc(var(--radius-button)-2px)] px-2 text-center text-sm font-bold whitespace-nowrap text-ink-muted transition-colors duration-(--duration-base) peer-checked:bg-surface peer-checked:text-ink-strong peer-checked:ring-1 peer-checked:ring-line peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-xs font-bold text-danger empty:hidden">
        {error}
      </p>
    </fieldset>
  );
}
