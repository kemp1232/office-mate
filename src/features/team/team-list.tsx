"use client";

import { useId, useState } from "react";
import { Check, Pencil, Search } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { gateBadge, matchesSearch, memberName, overrideChoice, ruleSummary, todaySummary } from "./model";
import { OverrideControl } from "./override-control";
import type { TeamMember } from "./service";

const BADGE_TONE = {
  neutral: "bg-surface-muted text-ink",
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
} as const;

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGE_TONE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-button px-2 py-0.5 text-xs font-bold whitespace-nowrap ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** The team: search, rules, today's status and today's Clock Out override for each person. */
export function TeamList({ members, timezone }: { members: TeamMember[]; timezone: string }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const deactivatedCount = members.filter((m) => m.deactivatedAt).length;
  const visible = members.filter((m) => (showDeactivated || !m.deactivatedAt) && matchesSearch(m, query));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5 sm:w-80">
          <label htmlFor={searchId} className="text-sm font-bold text-ink-strong">
            Search the team
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-4 my-auto size-5 text-ink-muted"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
              autoComplete="off"
              spellCheck={false}
              className="min-h-(--button-height) w-full rounded-input border border-line-strong bg-surface pr-4 pl-12 text-base text-ink-strong transition-colors duration-(--duration-base) placeholder:text-ink-muted focus:border-accent"
            />
          </div>
        </div>
        {deactivatedCount > 0 ? (
          // The whole 44px row is the checkbox (it sits invisibly on top); the box is drawn beside the text.
          <label className="relative flex min-h-(--touch-min) cursor-pointer items-center gap-3 text-sm font-bold text-ink-strong">
            <input
              type="checkbox"
              checked={showDeactivated}
              onChange={(e) => setShowDeactivated(e.target.checked)}
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-[0.3rem] border-2 border-line-strong bg-surface text-ink-inverse transition-colors duration-(--duration-base) peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent [&>svg]:invisible peer-checked:[&>svg]:visible"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            Show deactivated ({deactivatedCount})
          </label>
        ) : null}
      </div>

      <p className="text-sm text-ink-muted" aria-live="polite">
        {visible.length} {visible.length === 1 ? "person" : "people"}
        {query.trim() ? ` ${visible.length === 1 ? "matches" : "match"} “${query.trim()}”` : ""}
      </p>

      {visible.length === 0 ? (
        <StatusPanel
          tone="neutral"
          title={members.length === 0 ? "No team members yet" : "Nobody matches that search"}
          detail={
            members.length === 0
              ? "Add the first member to get started."
              : "Check the spelling, or try their email."
          }
        />
      ) : (
        <section
          aria-label="Team members"
          className="overflow-hidden rounded-card border border-stroke bg-surface"
        >
          <table className="w-full text-left">
            <thead className="sr-only lg:not-sr-only">
              <tr className="border-b border-stroke text-sm text-ink-muted">
                <th scope="col" className="px-6 py-3 font-bold">
                  Team member
                </th>
                <th scope="col" className="px-6 py-3 font-bold">
                  Clock Out rule
                </th>
                <th scope="col" className="px-6 py-3 font-bold">
                  Today
                </th>
                <th scope="col" className="px-6 py-3 font-bold">
                  Clock Out today
                </th>
                <th scope="col" className="px-6 py-3 font-bold">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const name = memberName(m);
                const badge = gateBadge(m, timezone);
                return (
                  // Phones/tablets: a stacked card. lg+: a table row.
                  <tr
                    key={m.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t border-stroke px-5 py-4 first:border-t-0 lg:table-row lg:first:border-t ${m.deactivatedAt ? "bg-surface-muted" : ""}`}
                  >
                    <th
                      scope="row"
                      className="col-start-1 row-start-1 min-w-0 font-normal lg:px-6 lg:py-4 lg:align-top"
                    >
                      <span className="block font-bold break-words text-ink-strong">{name}</span>
                      {name !== m.email ? (
                        <span className="block text-sm break-all text-ink-muted">{m.email}</span>
                      ) : null}
                      {m.deactivatedAt || !m.signedIn ? (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {m.deactivatedAt ? <Badge tone="warning">Deactivated</Badge> : null}
                          {!m.signedIn ? <Badge>Not signed in yet</Badge> : null}
                        </span>
                      ) : null}
                    </th>
                    <td className="col-span-2 text-sm text-ink lg:px-6 lg:py-4 lg:align-top">
                      <span className="text-ink-muted lg:sr-only">Rule: </span>
                      {ruleSummary(m.clockOut.rule)}
                    </td>
                    <td className="col-span-2 text-sm text-ink tabular-nums lg:px-6 lg:py-4 lg:align-top">
                      <span className="block">{todaySummary(m, timezone)}</span>
                      {badge ? (
                        <span className="mt-1 block">
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="col-span-2 lg:w-72 lg:px-6 lg:py-4 lg:align-top">
                      {m.deactivatedAt ? (
                        <span className="text-sm text-ink-muted">Can&apos;t sign in or clock in</span>
                      ) : (
                        <OverrideControl
                          memberId={m.id}
                          memberName={name}
                          value={overrideChoice(m.clockOut)}
                        />
                      )}
                    </td>
                    <td className="col-start-2 row-start-1 lg:px-6 lg:py-4 lg:text-right lg:align-top">
                      <LinkButton
                        variant="secondary"
                        size="sm"
                        href={`/admin/team/${m.id}`}
                        icon={<Pencil aria-hidden className="size-4" />}
                        aria-label={`Edit ${name}`}
                      >
                        Edit
                      </LinkButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
