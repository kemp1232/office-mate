import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { SheetsApi } from "@/features/sheets/client";
import { adminPool, createUser, OFFICE, setSettings } from "../support/db";

/**
 * The real queue (trigger + claim/complete SQL) and the real sync worker, against local Postgres,
 * with an in-memory stand-in for Google Sheets.
 */
const { syncPendingToSheet } = await import("@/features/sheets/sync");
const { db } = await import("@/lib/db");

/** A tiny in-memory spreadsheet: tab title → rows (row 1 = header). */
function fakeSheets(opts: { failWith?: string } = {}) {
  const tabs = new Map<string, string[][]>();
  const order: string[] = [];
  const fail = () => {
    if (opts.failWith) throw new Error(opts.failWith);
  };
  const api: SheetsApi = {
    async ensureTab(_id, title) {
      fail();
      if (!tabs.has(title)) {
        tabs.set(title, [["Name", "Email", "Time in", "Time out"]]);
        order.unshift(title);
      }
    },
    async readEmails(_id, title) {
      return (tabs.get(title) ?? []).slice(1).map((r) => r[1].toLowerCase());
    },
    async writeRow(_id, title, row, values) {
      tabs.get(title)![row - 1] = values;
    },
    async appendRow(_id, title, values) {
      tabs.get(title)!.push(values);
    },
  };
  return { api, tabs, order, setFail: (m?: string) => (opts.failWith = m) };
}

let admin: pg.Pool;

async function clock(userId: string, action: "CLOCK_IN" | "CLOCK_OUT") {
  const { rows } = await admin.query<{ r: { ok: boolean } }>(
    "select app.record_attendance($1::uuid, $2, $3, 10, 'DIRECT', $4, 'Asia/Manila') as r",
    [userId, OFFICE.latitude, OFFICE.longitude, action],
  );
  expect(rows[0].r.ok).toBe(true);
}

/** Runs the worker until the queue is drained. */
async function drain(api: SheetsApi) {
  for (let i = 0; i < 50; i++) {
    const outcome = await syncPendingToSheet({ api, limit: 100, timeZone: "Asia/Manila" });
    if (outcome.status !== "done" || outcome.synced + outcome.failed === 0) return outcome;
  }
  throw new Error("queue did not drain");
}

async function todayTitle() {
  const { rows } = await admin.query<{ t: string }>(
    "select to_char((now() at time zone 'Asia/Manila')::date, 'FMMonth FMDD, YYYY') as t",
  );
  return rows[0].t;
}

beforeAll(async () => {
  admin = adminPool();
  await setSettings(admin); // default report link = a Google Sheet
  await drain(fakeSheets().api); // clear anything queued by earlier suites
});

afterAll(async () => {
  await admin.end();
  await db().end();
});

describe("Google Sheet sync", () => {
  it("adds one row per person to today's tab, then fills Time out on the same row", async () => {
    const sheet = fakeSheets();
    const jane = await createUser(admin, { name: "Jane Doe" });
    const leo = await createUser(admin, { name: "Leo Cruz" });
    await clock(jane.id, "CLOCK_IN");
    await clock(leo.id, "CLOCK_IN");
    await drain(sheet.api);

    const title = await todayTitle();
    const rows = sheet.tabs.get(title)!;
    expect(rows[0]).toEqual(["Name", "Email", "Time in", "Time out"]);
    const janeRow = () => rows.find((r) => r[1] === jane.email)!;
    expect(janeRow()).toEqual(["Jane Doe", jane.email, expect.stringMatching(/^\d\d:\d\d$/), ""]);
    expect(rows.find((r) => r[1] === leo.email)).toBeDefined();

    await clock(jane.id, "CLOCK_OUT");
    await drain(sheet.api);
    expect(janeRow()[3]).toMatch(/^\d\d:\d\d$/);
    expect(rows.filter((r) => r[1] === jane.email)).toHaveLength(1); // updated, not duplicated
  });

  it("puts each office day on its own tab, named by date, newest first", async () => {
    const sheet = fakeSheets();
    const user = await createUser(admin, { name: "Mia Reyes" });
    // An earlier office day (inserted directly; the trigger still queues it).
    await admin.query(
      `insert into app.attendance_events (user_id, email, event_type, attendance_day, recorded_at, latitude, longitude,
         accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
       values ($1, $2, 'CLOCK_IN', '2026-09-10', '2026-09-10 01:00+00', 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50)`,
      [user.id, user.email],
    );
    await clock(user.id, "CLOCK_IN");
    await drain(sheet.api);

    expect(sheet.tabs.get("September 10, 2026")?.find((r) => r[1] === user.email)).toEqual([
      "Mia Reyes",
      user.email,
      "09:00",
      "",
    ]);
    const today = await todayTitle();
    expect(sheet.tabs.get(today)?.some((r) => r[1] === user.email)).toBe(true);
    expect(sheet.order.indexOf(today)).toBeLessThan(sheet.order.indexOf("September 10, 2026"));
  });

  it("keeps rows queued while Google fails, and catches up later without duplicates", async () => {
    const sheet = fakeSheets({ failWith: "The caller does not have permission" });
    const user = await createUser(admin, { name: "Ana Lim" });
    await clock(user.id, "CLOCK_IN");
    const failed = await syncPendingToSheet({ api: sheet.api, limit: 100, timeZone: "Asia/Manila" });
    expect(failed).toMatchObject({ status: "done", synced: 0 });
    const { rows } = await admin.query(
      "select synced_version < version as pending, last_error from app.sheet_sync where user_id = $1",
      [user.id],
    );
    expect(rows[0]).toEqual({ pending: true, last_error: "The caller does not have permission" });

    sheet.setFail(undefined);
    await drain(sheet.api);
    await drain(sheet.api);
    expect((sheet.tabs.get(await todayTitle()) ?? []).filter((r) => r[1] === user.email)).toHaveLength(1);
  });

  it("a newer event during an in-flight sync is not lost", async () => {
    const user = await createUser(admin, { name: "Ray Tan" });
    await clock(user.id, "CLOCK_IN");
    // Claim (as a worker would), then a Clock Out arrives before the worker reports back.
    const { rows } = await admin.query<{ version: number; attendance_day: string }>(
      "select version, attendance_day::text from app.claim_sheet_sync(100, 60) where user_id = $1",
      [user.id],
    );
    await clock(user.id, "CLOCK_OUT");
    await admin.query("select app.complete_sheet_sync($1::date, $2::uuid, $3, null)", [
      rows[0].attendance_day,
      user.id,
      rows[0].version,
    ]);
    const { rows: state } = await admin.query(
      "select synced_version < version as pending from app.sheet_sync where user_id = $1",
      [user.id],
    );
    expect(state[0].pending).toBe(true);
  });

  it("is off (and harmless) without Google credentials or a Google Sheet link", async () => {
    expect(await syncPendingToSheet({ api: null })).toEqual({ status: "disabled", reason: "NO_CREDENTIALS" });
    await admin.query("update app.attendance_settings set report_url = 'https://example.com/report'");
    try {
      expect(await syncPendingToSheet({ api: fakeSheets().api })).toEqual({
        status: "disabled",
        reason: "NO_SPREADSHEET",
      });
    } finally {
      await setSettings(admin);
    }
  });

  it("the runtime role can't read or edit the queue directly", async () => {
    const { rows } = await admin.query(
      "select has_table_privilege('attendance_app', 'app.sheet_sync', 'SELECT') as sel, has_table_privilege('attendance_app', 'app.sheet_sync', 'UPDATE') as upd",
    );
    expect(rows[0]).toEqual({ sel: false, upd: false });
  });
});
