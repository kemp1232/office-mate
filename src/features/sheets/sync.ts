import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSheetsApi, serviceAccountTokens, type SheetsApi } from "./client";
import { rowValues, spreadsheetIdFromUrl, tabTitle } from "./format";

/**
 * One-way export of attendance to the Admin's Google Sheet: one tab per office day
 * ("October 13, 2026"), one row per person (Name, Email, Time in, Time out).
 *
 * Driven by the database queue (app.sheet_sync): every clock event enqueues its person-day in the
 * same transaction, and this worker writes the person's whole row from the database, so retries
 * are idempotent and nothing is lost if Google is down. Never called inside the attendance
 * transaction and never blocks a Clock In / Clock Out.
 */

export type SyncOutcome =
  | { status: "disabled"; reason: "NO_CREDENTIALS" | "NO_SPREADSHEET" }
  | { status: "done"; synced: number; failed: number };

type Claimed = {
  attendance_day: string;
  user_id: string;
  version: number;
  name: string;
  email: string;
  clock_in: Date | null;
  clock_out: Date | null;
};

let cachedApi: SheetsApi | undefined;

function defaultApi(): SheetsApi | null {
  const e = env();
  if (!e.GOOGLE_SERVICE_ACCOUNT_EMAIL || !e.GOOGLE_SERVICE_ACCOUNT_KEY) return null;
  cachedApi ??= createSheetsApi({
    getAccessToken: serviceAccountTokens(e.GOOGLE_SERVICE_ACCOUNT_EMAIL, e.GOOGLE_SERVICE_ACCOUNT_KEY),
  });
  return cachedApi;
}

export async function syncPendingToSheet(
  opts: { api?: SheetsApi | null; limit?: number; timeZone?: string } = {},
): Promise<SyncOutcome> {
  const api = opts.api === undefined ? defaultApi() : opts.api;
  if (!api) return { status: "disabled", reason: "NO_CREDENTIALS" };

  const { rows: target } = await db().query<{ url: string | null }>("select app.sheet_sync_target() as url");
  const spreadsheetId = target[0]?.url ? spreadsheetIdFromUrl(target[0].url) : null;
  if (!spreadsheetId) return { status: "disabled", reason: "NO_SPREADSHEET" };

  const timeZone = opts.timeZone ?? env().ATTENDANCE_TIMEZONE;
  const { rows } = await db().query<Claimed>(
    `select attendance_day::text, user_id::text, version, name, email, clock_in, clock_out
     from app.claim_sheet_sync($1, 120)`,
    [opts.limit ?? 25],
  );

  let synced = 0;
  let failed = 0;
  // Group by day so each tab is checked/created once per run.
  for (const day of [...new Set(rows.map((r) => r.attendance_day))]) {
    const title = tabTitle(day);
    const people = rows.filter((r) => r.attendance_day === day);
    try {
      await api.ensureTab(spreadsheetId, title);
      const emails = await api.readEmails(spreadsheetId, title);
      for (const person of people) {
        try {
          const values = rowValues(
            {
              name: person.name,
              email: person.email,
              clockIn: person.clock_in?.toISOString() ?? null,
              clockOut: person.clock_out?.toISOString() ?? null,
            },
            timeZone,
          );
          const index = emails.indexOf(person.email.toLowerCase());
          if (index >= 0) await api.writeRow(spreadsheetId, title, index + 2, values);
          else {
            await api.appendRow(spreadsheetId, title, values);
            emails.push(person.email.toLowerCase());
          }
          await complete(person, null);
          synced += 1;
        } catch (error) {
          await complete(person, error);
          failed += 1;
        }
      }
    } catch (error) {
      for (const person of people) await complete(person, error);
      failed += people.length;
    }
  }
  return { status: "done", synced, failed };
}

async function complete(person: Claimed, error: unknown) {
  const message = error ? (error instanceof Error ? error.message : String(error)) : null;
  if (message) console.error("[sheets] sync failed:", message);
  await db().query("select app.complete_sheet_sync($1::date, $2::uuid, $3, $4)", [
    person.attendance_day,
    person.user_id,
    person.version,
    message,
  ]);
}

export type SheetSyncStatus = {
  configured: boolean;
  serviceAccountEmail: string | null;
  spreadsheetConfigured: boolean;
  pending: number;
  failing: number;
  lastError: string | null;
  lastSyncedAt: string | null;
};

/** Admin-only (checked in SQL too). */
export async function getSheetSyncStatus(adminUserId: string): Promise<SheetSyncStatus | null> {
  const e = env();
  const [{ rows }, { rows: target }] = await Promise.all([
    db().query<{ s: Record<string, unknown> }>("select app.sheet_sync_status($1::uuid) as s", [adminUserId]),
    db().query<{ url: string | null }>("select app.sheet_sync_target() as url"),
  ]);
  const s = rows[0].s;
  if (s.ok !== true) return null;
  return {
    configured: Boolean(e.GOOGLE_SERVICE_ACCOUNT_EMAIL && e.GOOGLE_SERVICE_ACCOUNT_KEY),
    serviceAccountEmail: e.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    spreadsheetConfigured: Boolean(target[0]?.url && spreadsheetIdFromUrl(target[0].url)),
    pending: Number(s.pending ?? 0),
    failing: Number(s.failing ?? 0),
    lastError: (s.last_error as string | null) ?? null,
    lastSyncedAt: (s.last_synced_at as string | null) ?? null,
  };
}
