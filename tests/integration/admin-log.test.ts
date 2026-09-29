import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { adminPool, adminUser, createUser, OFFICE, setSettings } from "../support/db";

const { getDayAttendance, getOfficeDays } = await import("@/features/admin-log/service");
const { db } = await import("@/lib/db");

let admin: pg.Pool;

const insertEvent = (
  user: { id: string; email: string },
  day: string,
  type: "CLOCK_IN" | "CLOCK_OUT",
  at: string,
) =>
  admin.query(
    `insert into app.attendance_events (user_id, email, event_type, attendance_day, recorded_at, latitude, longitude,
       accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
     values ($1, $2, $3, $4, $5, 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50)`,
    [user.id, user.email, type, day, at],
  );

beforeAll(async () => {
  admin = adminPool();
  await setSettings(admin);
});

afterAll(async () => {
  await admin.end();
  await db().end();
});

describe("Admin attendance log", () => {
  it("lists office days newest first and one row per person with clock in/out", async () => {
    const adminAccount = await adminUser(admin);
    const jane = await createUser(admin, { name: "Jane Doe" });
    const noName = await createUser(admin, { name: "" });
    await insertEvent(jane, "2020-10-13", "CLOCK_IN", "2020-10-13 01:04+00");
    await insertEvent(jane, "2020-10-13", "CLOCK_OUT", "2020-10-13 09:32+00");
    await insertEvent(noName, "2020-10-13", "CLOCK_IN", "2020-10-13 01:30+00");
    await insertEvent(jane, "2020-09-10", "CLOCK_IN", "2020-09-10 01:00+00");

    const days = (await getOfficeDays(adminAccount.id))!;
    expect(days.indexOf("2020-10-13")).toBeLessThan(days.indexOf("2020-09-10"));

    // Rows are immutable and dates fixed, so earlier runs' rows remain: look only at this run's users.
    const rows = (await getDayAttendance(adminAccount.id, "2020-10-13"))!.filter((r) =>
      [jane.email, noName.email].includes(r.email),
    );
    expect(rows.map((r) => r.email)).toEqual([jane.email, noName.email]); // ordered by clock-in
    expect(rows[0]).toMatchObject({
      name: "Jane Doe",
      clockInAt: expect.any(String),
      clockOutAt: expect.any(String),
    });
    expect(rows[1]).toMatchObject({ name: "", clockOutAt: null });
    expect(await getDayAttendance(adminAccount.id, "2020-09-11")).toEqual([]);
  });

  it("is Admin-only", async () => {
    const member = await createUser(admin);
    expect(await getOfficeDays(member.id)).toBeNull();
    expect(await getDayAttendance(member.id, "2020-10-13")).toBeNull();
  });

  it("the Admin can't clock in or out (database refuses)", async () => {
    const adminAccount = await adminUser(admin);
    const { rows } = await admin.query<{ r: { code: string } }>(
      "select app.record_attendance($1::uuid, $2, $3, 10, 'DIRECT', 'CLOCK_IN', 'Asia/Manila') as r",
      [adminAccount.id, OFFICE.latitude, OFFICE.longitude],
    );
    expect(rows[0].r.code).toBe("FORBIDDEN");
  });
});
