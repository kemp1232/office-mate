import { describe, expect, it } from "vitest";
import { canStart, initialScreenState, screenReducer, type ScreenState } from "@/features/attendance/model";
import { errorMessage, successMessage, syncedMessage } from "@/features/attendance/messages";
import { clockInputSchema, type AttendanceState } from "@/features/attendance/types";

const base: AttendanceState = {
  configured: true,
  attendance_day: "2026-09-28",
  timezone: "Asia/Manila",
  clock_in_at: null,
  clock_out_at: null,
  next_action: "CLOCK_IN",
  radius_m: 300,
  accuracy_threshold_m: 50,
};
const clockedIn: AttendanceState = {
  ...base,
  clock_in_at: "2026-09-28T01:04:00Z",
  next_action: "CLOCK_OUT",
};
const complete: AttendanceState = {
  ...clockedIn,
  clock_out_at: "2026-09-28T09:32:00Z",
  next_action: "DAY_COMPLETE",
};

const run = (state: ScreenState, ...events: Parameters<typeof screenReducer>[1][]) =>
  events.reduce(screenReducer, state);

describe("attendance screen reducer", () => {
  it("runs the happy path: tap → locating → verifying → success with server state", () => {
    const s = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 12 },
      {
        type: "RESULT",
        result: {
          ok: true,
          eventType: "CLOCK_IN",
          accuracyM: 12,
          distanceM: 40,
          state: clockedIn,
        },
      },
    );
    expect(s.phase).toEqual({
      name: "success",
      action: "CLOCK_IN",
      accuracyM: 12,
    });
    expect(s.attendance.next_action).toBe("CLOCK_OUT");
  });

  it("ignores repeated taps while an attempt is running", () => {
    const started = run(initialScreenState(base), {
      type: "START",
      action: "CLOCK_IN",
    });
    expect(screenReducer(started, { type: "START", action: "CLOCK_IN" })).toBe(started);
  });

  it("only starts the server-derived next action", () => {
    const s = initialScreenState(clockedIn);
    expect(screenReducer(s, { type: "START", action: "CLOCK_IN" })).toBe(s);
    expect(
      screenReducer(initialScreenState(complete), {
        type: "START",
        action: "CLOCK_OUT",
      }).phase.name,
    ).toBe("idle");
  });

  it("does not start when attendance is not configured", () => {
    const s = initialScreenState({ ...base, configured: false });
    expect(screenReducer(s, { type: "START", action: "CLOCK_IN" })).toBe(s);
  });

  it.each(["PERMISSION_DENIED", "POSITION_UNAVAILABLE", "TIMEOUT"] as const)(
    "geolocation %s → retryable error",
    (kind) => {
      const s = run(
        initialScreenState(base),
        { type: "START", action: "CLOCK_IN" },
        { type: "GEO_FAILED", kind },
      );
      expect(s.phase).toMatchObject({ name: "error", error: { kind } });
      expect(s.attendance).toBe(base);
    },
  );

  it("offline during a request → error, never success, state unchanged", () => {
    const s = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 10 },
      { type: "OFFLINE" },
    );
    expect(s.phase).toMatchObject({
      name: "error",
      error: { kind: "OFFLINE" },
    });
    expect(s.attendance.next_action).toBe("CLOCK_IN");
  });

  it("maps server rejections without changing attendance state", () => {
    const start = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 80 },
    );
    const acc = screenReducer(start, {
      type: "RESULT",
      result: {
        ok: false,
        code: "ACCURACY_TOO_LOW",
        accuracyM: 80,
        thresholdM: 50,
      },
    });
    expect(acc.phase).toMatchObject({
      name: "error",
      error: { kind: "ACCURACY_TOO_LOW", accuracyM: 80, thresholdM: 50 },
    });
    const out = screenReducer(start, {
      type: "RESULT",
      result: {
        ok: false,
        code: "OUTSIDE_GEOFENCE",
        distanceM: 420,
        radiusM: 300,
      },
    });
    expect(out.phase).toMatchObject({
      name: "error",
      error: { kind: "OUTSIDE_GEOFENCE", distanceM: 420 },
    });
    expect(out.attendance).toBe(base);
  });

  it("STATE_CHANGED resyncs to the authoritative state (e.g. a retry after success)", () => {
    const s = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 10 },
      {
        type: "RESULT",
        result: { ok: false, code: "STATE_CHANGED", state: clockedIn },
      },
    );
    expect(s.phase).toEqual({ name: "synced", action: "CLOCK_IN" });
    expect(s.attendance.next_action).toBe("CLOCK_OUT");
  });

  it("NOT_CONFIGURED disables attendance", () => {
    const s = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 10 },
      { type: "RESULT", result: { ok: false, code: "NOT_CONFIGURED" } },
    );
    expect(s.attendance.configured).toBe(false);
  });
});

describe("attendance copy", () => {
  it("uses Clock In / Clock Out wording", () => {
    expect(errorMessage("CLOCK_IN", { kind: "PERMISSION_DENIED" }).title).toBe(
      "Location access is required to clock in",
    );
    expect(errorMessage("CLOCK_OUT", { kind: "PERMISSION_DENIED" }).title).toBe(
      "Location access is required to clock out",
    );
    expect(
      errorMessage("CLOCK_OUT", {
        kind: "OUTSIDE_GEOFENCE",
        distanceM: 420,
        radiusM: 300,
      }).detail,
    ).toContain("You need to be within the office area to clock out");
  });

  it("matches the approved messages", () => {
    const outside = errorMessage("CLOCK_IN", {
      kind: "OUTSIDE_GEOFENCE",
      distanceM: 420.4,
      radiusM: 300,
    });
    expect(outside.title).toBe("Outside the office area");
    expect(outside.detail).toMatch(/^420m away · limit 300m/);
    expect(
      errorMessage("CLOCK_IN", {
        kind: "ACCURACY_TOO_LOW",
        accuracyM: 80,
        thresholdM: 50,
      }).title,
    ).toMatch(/A more accurate location is needed – try again outdoors/);
    expect(errorMessage("CLOCK_IN", { kind: "OFFLINE", unconfirmed: false }).title).toBe(
      "No connection – try again",
    );
    expect(errorMessage("CLOCK_IN", { kind: "NOT_CONFIGURED" }).title).toBe("Attendance isn't set up yet");
    expect(successMessage("CLOCK_IN", clockedIn, 12)).toMatchObject({
      title: "Clocked in at 09:04",
      detail: "You're at the office · Verified · 12m accuracy",
    });
    expect(successMessage("CLOCK_OUT", complete, 8).title).toBe("Clocked out at 17:32");
  });

  it("never claims nothing was recorded when a sent request failed", () => {
    expect(errorMessage("CLOCK_IN", { kind: "OFFLINE", unconfirmed: false }).detail).toBeUndefined();
    expect(errorMessage("CLOCK_IN", { kind: "OFFLINE", unconfirmed: true }).detail).toMatch(
      /couldn't confirm your Clock In/,
    );
    expect(errorMessage("CLOCK_OUT", { kind: "SERVER_ERROR" }).detail).toMatch(
      /couldn't confirm your Clock Out/,
    );
  });

  it("explains a state that moved on without the user acting", () => {
    expect(syncedMessage("CLOCK_IN", clockedIn).title).toBe("You're already clocked in at 09:04");
    expect(syncedMessage("CLOCK_OUT", complete).title).toBe("You're already clocked out at 17:32");
    expect(syncedMessage("CLOCK_IN", complete).title).toBe("Attendance is already complete for today");
    expect(syncedMessage("CLOCK_OUT", base).title).toBe("A new attendance day has started");
  });
});

describe("retry and resync safety", () => {
  const offline = (action: "CLOCK_IN" | "CLOCK_OUT", attendance: AttendanceState) =>
    run(
      initialScreenState(attendance),
      { type: "START", action },
      { type: "LOCATED", accuracyM: 10 },
      { type: "OFFLINE", unconfirmed: true },
    );

  it("a lost response whose Clock In actually committed shows 'already clocked in', not a Clock Out prompt", () => {
    const failed = offline("CLOCK_IN", base);
    expect(failed.phase).toMatchObject({ name: "error", error: { kind: "OFFLINE", unconfirmed: true } });
    const synced = screenReducer(failed, { type: "SYNC", attendance: clockedIn, attempted: "CLOCK_IN" });
    expect(synced.phase).toEqual({ name: "synced", action: "CLOCK_IN" });
    expect(synced.attendance.next_action).toBe("CLOCK_OUT");
  });

  it("a resync that confirms nothing was recorded keeps the error (retry allowed)", () => {
    const failed = offline("CLOCK_IN", base);
    const synced = screenReducer(failed, { type: "SYNC", attendance: base, attempted: "CLOCK_IN" });
    expect(synced.phase.name).toBe("error");
    expect(canStart(synced, "CLOCK_IN")).toBe(true);
  });

  it("SYNC is ignored while an attempt is running", () => {
    const busy = run(initialScreenState(base), { type: "START", action: "CLOCK_IN" });
    expect(screenReducer(busy, { type: "SYNC", attendance: clockedIn })).toBe(busy);
  });

  it("a new day (visibility/midnight resync) returns to idle with the fresh state", () => {
    const s = screenReducer(initialScreenState(complete), {
      type: "SYNC",
      attendance: { ...base, attendance_day: "2026-09-29" },
    });
    expect(s.phase.name).toBe("idle");
    expect(s.attendance.next_action).toBe("CLOCK_IN");
  });

  it("canStart mirrors the reducer's START rule", () => {
    expect(canStart(initialScreenState(base), "CLOCK_IN")).toBe(true);
    expect(canStart(initialScreenState(base), "CLOCK_OUT")).toBe(false);
    expect(canStart(initialScreenState({ ...base, configured: false }), "CLOCK_IN")).toBe(false);
    expect(canStart(run(initialScreenState(base), { type: "START", action: "CLOCK_IN" }), "CLOCK_IN")).toBe(
      false,
    );
  });

  it.each([
    ["UNAUTHENTICATED", "SIGNED_OUT"],
    ["FORBIDDEN", "SIGNED_OUT"],
    ["INVALID_INPUT", "SERVER_ERROR"],
    ["SERVER_ERROR", "SERVER_ERROR"],
  ] as const)("maps %s to %s", (code, kind) => {
    const s = run(
      initialScreenState(base),
      { type: "START", action: "CLOCK_IN" },
      { type: "LOCATED", accuracyM: 10 },
      { type: "RESULT", result: { ok: false, code } },
    );
    expect(s.phase).toMatchObject({ name: "error", error: { kind } });
  });

  it("ignores results that arrive outside the verifying phase, and DISMISS while busy", () => {
    const idle = initialScreenState(base);
    expect(screenReducer(idle, { type: "RESULT", result: { ok: false, code: "SERVER_ERROR" } })).toBe(idle);
    const busy = run(idle, { type: "START", action: "CLOCK_IN" });
    expect(screenReducer(busy, { type: "DISMISS" })).toBe(busy);
  });
});

describe("clock input schema (the only thing the browser may send)", () => {
  const valid = {
    latitude: 14.55,
    longitude: 121.02,
    accuracy: 12,
    source: "QR",
    expectedAction: "CLOCK_IN",
  };

  it("accepts a valid payload", () => {
    expect(clockInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    { ...valid, latitude: 91 },
    { ...valid, longitude: -181 },
    { ...valid, accuracy: 0 },
    { ...valid, accuracy: Number.NaN },
    { ...valid, latitude: Number.POSITIVE_INFINITY },
    { ...valid, expectedAction: "DAY_COMPLETE" },
    { ...valid, source: "NFC" },
    { ...valid, latitude: "14.55" },
  ])("rejects invalid values %#", (payload) => {
    expect(clockInputSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    { isInsideGeofence: true },
    { role: "admin" },
    { timestamp: "2026-01-01T00:00:00Z" },
    { type: "CLOCK_IN" },
  ])("rejects client-asserted fields %o", (extra) => {
    expect(clockInputSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
});
