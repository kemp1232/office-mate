import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { orgDate } from "@/features/attendance/format";
import { adminPool, adminUser, createUser, OFFICE, officeOffset, setSettings } from "../support/db";

/**
 * The real server service layer (what Server Actions call), with the org timezone coming from the
 * ATTENDANCE_TIMEZONE env var — set here to UTC+14 to prove the day never follows the host's zone.
 */
const TZ = "Pacific/Kiritimati";
process.env.ATTENDANCE_TIMEZONE = TZ;
const { getTodayState, recordAttendance } = await import("@/features/attendance/service");
const { getAdminSettings, updateAdminSettings } = await import("@/features/settings/service");
const { db } = await import("@/lib/db");

let admin: pg.Pool;
const input = (metres: number, accuracy = 10, expectedAction: "CLOCK_IN" | "CLOCK_OUT" = "CLOCK_IN") =>
  ({
    latitude: officeOffset(metres),
    longitude: OFFICE.longitude,
    accuracy,
    source: "QR",
    expectedAction,
  }) as const;

beforeAll(async () => {
  admin = adminPool();
  await setSettings(admin);
});

afterAll(async () => {
  await admin.end();
  await db().end();
});

describe("attendance service", () => {
  it("uses ATTENDANCE_TIMEZONE (not the host/UTC) for the attendance day", async () => {
    const user = await createUser(admin);
    const state = await getTodayState(user.id);
    expect(state?.timezone).toBe(TZ);
    expect(state?.attendance_day).toBe(orgDate(new Date(), TZ));

    const result = await recordAttendance(user.id, input(20));
    expect(result).toMatchObject({ ok: true, eventType: "CLOCK_IN", distanceM: 20 });
    const { rows } = await admin.query(
      "select attendance_day::text as day from app.attendance_events where user_id = $1",
      [user.id],
    );
    expect(rows[0].day).toBe(orgDate(new Date(), TZ));
  });

  it("maps every database outcome to the client result shape", async () => {
    const user = await createUser(admin);
    expect(await recordAttendance(user.id, input(5000, 80))).toEqual({
      ok: false,
      code: "ACCURACY_TOO_LOW",
      accuracyM: 80,
      thresholdM: 50,
    });
    expect(await recordAttendance(user.id, input(420))).toEqual({
      ok: false,
      code: "OUTSIDE_GEOFENCE",
      distanceM: 420,
      radiusM: 300,
    });
    expect(await recordAttendance(user.id, input(10, 10, "CLOCK_OUT"))).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
      state: { next_action: "CLOCK_IN" },
    });
    expect(await recordAttendance(user.id, input(10))).toMatchObject({
      ok: true,
      state: { next_action: "CLOCK_OUT" },
    });
  });

  it("returns FORBIDDEN / null for accounts that aren't verified team members", async () => {
    const unverified = await createUser(admin, { verified: false });
    expect(await getTodayState(unverified.id)).toBeNull();
    expect(await recordAttendance(unverified.id, input(10))).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("reports NOT_CONFIGURED when no office is set", async () => {
    const user = await createUser(admin);
    await setSettings(admin, { configured: false });
    try {
      expect(await recordAttendance(user.id, input(10))).toEqual({ ok: false, code: "NOT_CONFIGURED" });
      expect((await getTodayState(user.id))?.configured).toBe(false);
    } finally {
      await setSettings(admin);
    }
  });
});

describe("settings service", () => {
  it("a Team Member can neither read nor change Admin settings", async () => {
    const member = await createUser(admin);
    expect(await getAdminSettings(member.id)).toBeNull();
    expect(
      await updateAdminSettings(member.id, {
        officeLatitude: 0,
        officeLongitude: 0,
        radiusM: 5000,
        accuracyThresholdM: 1000,
        reportUrl: "https://evil.example",
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("the Admin can update location, radius, accuracy and the report link", async () => {
    const adminAccount = await adminUser(admin);
    const result = await updateAdminSettings(adminAccount.id, {
      officeLatitude: OFFICE.latitude,
      officeLongitude: OFFICE.longitude,
      radiusM: 250,
      accuracyThresholdM: 300,
      reportUrl: "https://docs.google.com/spreadsheets/d/test/edit",
    });
    expect(result).toMatchObject({ ok: true, settings: { radiusM: 250, accuracyThresholdM: 300 } });
    expect((await getAdminSettings(adminAccount.id))?.reportUrl).toBe(
      "https://docs.google.com/spreadsheets/d/test/edit",
    );
    await setSettings(admin);
  });
});
