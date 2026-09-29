import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { PageTransition } from "@/components/page-transition";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { StatusPanel } from "@/components/ui/status-panel";
import { DaySelect } from "@/features/admin-log/day-select";
import { displayName, getDayAttendance, getOfficeDays } from "@/features/admin-log/service";
import { formatClockTime } from "@/features/attendance/format";
import { requireAdminPage } from "@/features/auth/dal";
import { getAdminSettings } from "@/features/settings/service";
import { tabTitle } from "@/features/sheets/format";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Attendance log" };

export default async function AttendanceLogPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const viewer = await requireAdminPage("/admin/attendance");
  const [{ day: requested }, days, settings] = await Promise.all([
    searchParams,
    getOfficeDays(viewer.id),
    getAdminSettings(viewer.id),
  ]);
  if (!days || !settings) throw new Error("Attendance log unavailable");

  // Default to the latest office day; ignore anything that isn't one.
  const day = requested && days.includes(requested) ? requested : days[0];
  const rows = day ? await getDayAttendance(viewer.id, day) : [];
  if (!rows) throw new Error("Attendance log unavailable");
  const tz = env().ATTENDANCE_TIMEZONE;
  const time = (iso: string | null) => (iso ? formatClockTime(iso, tz) : "—");
  const labels = Object.fromEntries(days.map((d) => [d, tabTitle(d)]));
  const clockedOut = rows.filter((r) => r.clockOutAt).length;

  return (
    // Outermost element, so React animates the whole page in/out on navigation.
    <PageTransition>
      <div className="flex min-h-dvh flex-col">
        <AppHeader viewer={viewer} current="log" />
        <main className="flex-1 px-gutter pb-safe">
          <div className="mx-auto flex max-w-(--container-admin) flex-col gap-5 py-5 sm:py-8">
            <div>
              <Eyebrow>Admin</Eyebrow>
              <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">Attendance log</h1>
              <p className="mt-1 text-ink-muted">
                Clock ins and outs for each office day. Records can&apos;t be edited.
              </p>
            </div>

            {settings.officeLatitude === null ? (
              <StatusPanel
                compact
                tone="warning"
                title="Attendance setup incomplete"
                detail="Set the office location before the team can clock in."
              >
                <LinkButton
                  size="sm"
                  href="/admin/settings"
                  icon={<Settings aria-hidden className="size-4" />}
                  className="mt-2"
                >
                  Open settings
                </LinkButton>
              </StatusPanel>
            ) : null}

            {day ? (
              <>
                <DaySelect days={days} value={day} labels={labels} />
                <section
                  aria-labelledby="day-heading"
                  className="flex flex-col gap-4 overflow-hidden rounded-card border border-stroke bg-surface"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6 sm:pt-6">
                    <h2 id="day-heading" className="text-lg">
                      {labels[day]}
                    </h2>
                    <p className="text-sm text-ink-muted">
                      {rows.length} {rows.length === 1 ? "person" : "people"} · {clockedOut} clocked out
                    </p>
                  </div>
                  <table className="w-full text-left">
                    <thead className="sr-only sm:not-sr-only">
                      <tr className="border-y border-stroke text-sm text-ink-muted">
                        <th scope="col" className="px-5 py-3 font-bold sm:px-6">
                          Team member
                        </th>
                        <th scope="col" className="px-5 py-3 font-bold sm:px-6">
                          Clock in
                        </th>
                        <th scope="col" className="px-5 py-3 font-bold sm:px-6">
                          Clock out
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        // Phones: a stacked row (name on top, times below). sm+: a normal table row.
                        <tr
                          key={row.email}
                          className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-stroke px-5 py-4 first:border-t-0 sm:table-row sm:first:border-t"
                        >
                          <th
                            scope="row"
                            className="col-span-2 font-bold break-all text-ink-strong sm:px-6 sm:py-4 sm:break-normal"
                            title={row.email}
                          >
                            {displayName(row)}
                          </th>
                          <td className="text-sm tabular-nums sm:px-6 sm:py-4 sm:text-base">
                            <span className="text-ink-muted sm:sr-only">In </span>
                            <time dateTime={row.clockInAt ?? undefined}>{time(row.clockInAt)}</time>
                          </td>
                          <td className="text-sm tabular-nums sm:px-6 sm:py-4 sm:text-base">
                            <span className="text-ink-muted sm:sr-only">Out </span>
                            {row.clockOutAt ? (
                              <time dateTime={row.clockOutAt}>{time(row.clockOutAt)}</time>
                            ) : (
                              <span className="text-ink-muted">Not yet</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            ) : (
              <StatusPanel
                tone="neutral"
                title="No clock-ins yet"
                detail="Office days appear here after the first Clock In."
              />
            )}
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
