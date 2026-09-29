const formatters = new Map<string, Intl.DateTimeFormat>();

/** Intl formatters are costly to build; keep one per (locale, options). */
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}

/**
 * Time formatting in the ORGANISATION timezone (from the server), never the host's zone.
 * Vercel runs in UTC and a phone may be set to any zone; attendance is shown in org time.
 */

export function formatClockTime(iso: string, timeZone: string): string {
  return formatter("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** e.g. "Monday, 28 September" for the attendance day (a plain YYYY-MM-DD date). */
export function formatAttendanceDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return formatter("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "3h 12m" / "12m" / "0m". */
export function formatElapsed(fromIso: string, to: Date | string): string {
  const end = typeof to === "string" ? new Date(to) : to;
  const minutes = Math.max(0, Math.floor((end.getTime() - new Date(fromIso).getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The calendar date (YYYY-MM-DD) of `at` in the organisation timezone. */
export function orgDate(at: Date, timeZone: string): string {
  return formatter("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(at);
}
