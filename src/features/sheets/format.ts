import { formatClockTime } from "@/features/attendance/format";

/** Columns written to each office-day tab. */
export const SHEET_HEADER = ["Name", "Email", "Time in", "Time out"] as const;

/** The spreadsheet id from a Google Sheets URL (`/spreadsheets/d/<id>/…`), or null. */
export function spreadsheetIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "docs.google.com") return null;
    return /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Tab title for an attendance day (`YYYY-MM-DD`), e.g. "October 13, 2026". */
export function tabTitle(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A1 range inside a tab; tab names are quoted (they contain spaces and commas). */
export function a1(tab: string, range: string): string {
  return `'${tab.replaceAll("'", "''")}'!${range}`;
}

export type SheetPerson = {
  name: string;
  email: string;
  clockIn: string | null;
  clockOut: string | null;
};

/** One person's row for the day, times in the organisation timezone. */
export function rowValues(person: SheetPerson, timeZone: string): string[] {
  const time = (iso: string | null) => (iso ? formatClockTime(iso, timeZone) : "");
  return [person.name, person.email, time(person.clockIn), time(person.clockOut)];
}
