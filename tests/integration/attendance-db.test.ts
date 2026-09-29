import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { ADMIN_EMAILS } from "@/features/auth/roles";
import { adminPool, appPool, createUser, DEG_PER_M, OFFICE, setSettings, uniqueEmail } from "../support/db";

/**
 * Integration tests against the real local Postgres, exercising the trust boundary exactly
 * as the Next.js server does (as the least-privilege attendance_app role).
 */
let admin: pg.Pool;
let app: pg.Pool;

const record = (userId: string, expected: "CLOCK_IN" | "CLOCK_OUT", lat = OFFICE.latitude, accuracy = 10) =>
  app
    .query<{ r: Record<string, unknown> }>(
      "select app.record_attendance($1::uuid, $2, $3, $4, 'DIRECT', $5, 'Asia/Manila') as r",
      [userId, lat, OFFICE.longitude, accuracy, expected],
    )
    .then((res) => res.rows[0].r);

const countEvents = async (userId: string) =>
  Number(
    (await admin.query("select count(*) from app.attendance_events where user_id = $1", [userId])).rows[0]
      .count,
  );

beforeAll(async () => {
  admin = adminPool();
  app = appPool(12);
  await setSettings(admin);
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe("concurrency and retries", () => {
  it("10 simultaneous Clock In requests create exactly one Clock In", async () => {
    const user = await createUser(admin);
    const results = await Promise.all(Array.from({ length: 10 }, () => record(user.id, "CLOCK_IN")));
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.code === "STATE_CHANGED")).toHaveLength(9);
    expect(await countEvents(user.id)).toBe(1);
  });

  it("10 simultaneous Clock Out requests create exactly one Clock Out", async () => {
    const user = await createUser(admin);
    expect((await record(user.id, "CLOCK_IN")).ok).toBe(true);
    const results = await Promise.all(Array.from({ length: 10 }, () => record(user.id, "CLOCK_OUT")));
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(await countEvents(user.id)).toBe(2);
  });

  it("mixed simultaneous Clock In + Clock Out never produce a Clock Out without a Clock In", async () => {
    const user = await createUser(admin);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => record(user.id, i % 2 ? "CLOCK_OUT" : "CLOCK_IN")),
    );
    const { rows } = await admin.query<{ event_type: string }>(
      "select event_type from app.attendance_events where user_id = $1 order by recorded_at",
      [user.id],
    );
    expect(rows[0]?.event_type).toBe("CLOCK_IN");
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.ok === true)).toHaveLength(rows.length);
  });

  it("a network retry of a successful Clock In is a no-op that reports the real state", async () => {
    const user = await createUser(admin);
    await record(user.id, "CLOCK_IN");
    const retry = await record(user.id, "CLOCK_IN");
    expect(retry).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
      state: { next_action: "CLOCK_OUT" },
    });
    expect(await countEvents(user.id)).toBe(1);
  });
});

describe("geofence boundaries through the real function", () => {
  it("passes just inside and fails just outside the radius", async () => {
    const user = await createUser(admin);
    const outside = await record(user.id, "CLOCK_IN", OFFICE.latitude + 300.5 * DEG_PER_M);
    expect(outside).toMatchObject({
      ok: false,
      code: "OUTSIDE_GEOFENCE",
      radius_m: 300,
    });
    const inside = await record(user.id, "CLOCK_IN", OFFICE.latitude + 299.5 * DEG_PER_M);
    expect(inside.ok).toBe(true);
  });

  it("rejects accuracy worse than the threshold before comparing distance", async () => {
    const user = await createUser(admin);
    const r = await record(user.id, "CLOCK_IN", OFFICE.latitude + 5000 * DEG_PER_M, 51);
    expect(r).toMatchObject({
      ok: false,
      code: "ACCURACY_TOO_LOW",
      accuracy_threshold_m: 50,
    });
    expect(await countEvents(user.id)).toBe(0);
  });
});

describe("authorisation inside the database", () => {
  it("the SQL Admin allow-list is exactly the app's allow-list", async () => {
    const { rows } = await admin.query<{ emails: string[] }>("select app.admin_emails() as emails");
    expect([...rows[0].emails].sort()).toEqual([...ADMIN_EMAILS].sort());
  });

  it("is_admin grants only allow-listed, verified accounts", async () => {
    const adminUser = await createUser(admin, { email: ADMIN_EMAILS[0] });
    const member = await createUser(admin, { email: uniqueEmail("admin") });
    const isAdmin = async (id: string) =>
      (await app.query<{ ok: boolean }>("select app.is_admin($1::uuid) as ok", [id])).rows[0].ok;
    expect(await isAdmin(adminUser.id)).toBe(true);
    expect(await isAdmin(member.id)).toBe(false);
  });

  it("a Team Member cannot change settings even by calling the function directly", async () => {
    const member = await createUser(admin);
    const r = await app.query<{ r: { code: string } }>(
      "select app.update_admin_settings($1::uuid, 0, 0, 5000, 1000, 'https://evil.example') as r",
      [member.id],
    );
    expect(r.rows[0].r.code).toBe("FORBIDDEN");
    const { rows } = await admin.query("select radius_m from app.attendance_settings");
    expect(rows[0].radius_m).toBe(300);
  });

  it("the runtime role cannot modify attendance history", async () => {
    await expect(app.query("update app.attendance_events set latitude = 0")).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query("delete from app.attendance_events")).rejects.toThrow(/permission denied/);
  });

  it("an unverified account cannot record attendance", async () => {
    const user = await createUser(admin, { verified: false });
    expect(await record(user.id, "CLOCK_IN")).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});
