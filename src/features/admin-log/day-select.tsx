"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

/** Office-day picker at the top of the attendance log. Changing it loads that day. */
export function DaySelect({
  days,
  value,
  labels,
}: {
  days: string[];
  value: string;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="office-day" className="text-sm font-bold text-ink-strong">
        Office day
      </label>
      <div className="relative">
        <CalendarDays
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-4 my-auto size-5 text-ink-muted"
        />
        <select
          id="office-day"
          value={value}
          aria-busy={pending || undefined}
          onChange={(e) => startTransition(() => router.push(`/admin/attendance?day=${e.target.value}`))}
          className="min-h-(--button-height) w-full cursor-pointer appearance-none rounded-input border border-line-strong bg-surface pr-4 pl-12 text-base font-bold text-ink-strong transition-colors duration-(--duration-base) focus:border-accent sm:max-w-sm"
        >
          {days.map((day) => (
            <option key={day} value={day}>
              {labels[day]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
