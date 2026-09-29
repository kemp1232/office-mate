import { describe, expect, it, vi } from "vitest";
import { formatAttendanceDay, formatClockTime, formatElapsed, orgDate } from "@/features/attendance/format";
import { requestCurrentPosition } from "@/features/attendance/geolocation";
import { attendanceQrUrl } from "@/features/qr/qr-url";
import { settingsInputSchema } from "@/features/settings/schema";

describe("time formatting uses the org timezone, not the host", () => {
  it("runs with the host in UTC (like Vercel)", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  it("formats 01:04 UTC as 09:04 Manila", () => {
    expect(formatClockTime("2026-09-28T01:04:00Z", "Asia/Manila")).toBe("09:04");
  });

  it("formats times across Manila midnight correctly", () => {
    expect(formatClockTime("2026-09-28T16:30:00Z", "Asia/Manila")).toBe("00:30");
  });

  it("formats the attendance day without shifting it", () => {
    expect(formatAttendanceDay("2026-09-28")).toBe("Monday 28 September");
  });

  it("computes the org calendar date for day-rollover checks", () => {
    expect(orgDate(new Date("2026-09-28T15:59:00Z"), "Asia/Manila")).toBe("2026-09-28");
    expect(orgDate(new Date("2026-09-28T16:00:00Z"), "Asia/Manila")).toBe("2026-09-29");
  });

  it("formats elapsed time", () => {
    expect(formatElapsed("2026-09-28T01:04:00Z", "2026-09-28T04:16:30Z")).toBe("3h 12m");
    expect(formatElapsed("2026-09-28T01:04:00Z", "2026-09-28T01:16:00Z")).toBe("12m");
    expect(formatElapsed("2026-09-28T01:04:00Z", "2026-09-28T01:00:00Z")).toBe("0m");
  });
});

describe("geolocation is requested exactly once per tap", () => {
  it("uses getCurrentPosition (never watchPosition) with high accuracy and no cache", async () => {
    const geo = {
      getCurrentPosition: vi.fn((ok: PositionCallback) =>
        ok({
          coords: { latitude: 1, longitude: 2, accuracy: 9 },
        } as GeolocationPosition),
      ),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    } as unknown as Geolocation;
    await expect(requestCurrentPosition(geo)).resolves.toEqual({
      ok: true,
      position: { latitude: 1, longitude: 2, accuracy: 9 },
    });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(vi.mocked(geo.getCurrentPosition).mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
    });
  });

  it.each([
    [1, "PERMISSION_DENIED"],
    [2, "POSITION_UNAVAILABLE"],
    [3, "TIMEOUT"],
  ])("maps error code %i to %s", async (code, kind) => {
    const geo = {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code } as GeolocationPositionError),
    } as unknown as Geolocation;
    await expect(requestCurrentPosition(geo)).resolves.toEqual({
      ok: false,
      kind,
    });
  });

  it("reports unsupported browsers", async () => {
    await expect(requestCurrentPosition(undefined)).resolves.toEqual({
      ok: false,
      kind: "UNSUPPORTED",
    });
  });
});

describe("QR code", () => {
  it("points to the Attendance app with source=qr and nothing else", () => {
    expect(attendanceQrUrl("https://attendance.firstmate.tech")).toBe(
      "https://attendance.firstmate.tech/attendance?source=qr",
    );
  });
});

describe("admin settings validation", () => {
  const valid = {
    officeLatitude: 14.55,
    officeLongitude: 121.02,
    radiusM: 300,
    accuracyThresholdM: 50,
    reportUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
  };

  it("accepts defaults and the 300 m accuracy the team wants for indoor use", () => {
    expect(settingsInputSchema.safeParse(valid).success).toBe(true);
    expect(settingsInputSchema.safeParse({ ...valid, accuracyThresholdM: 300 }).success).toBe(true);
  });

  it.each([
    [{ radiusM: 5 }, "radiusM"],
    [{ radiusM: 12.5 }, "radiusM"],
    [{ accuracyThresholdM: 0 }, "accuracyThresholdM"],
    [{ reportUrl: "not a url" }, "reportUrl"],
    [{ reportUrl: "http://docs.google.com" }, "reportUrl"],
    [{ reportUrl: "javascript:alert(1)" }, "reportUrl"],
    [{ officeLongitude: null }, "officeLatitude"],
  ])("rejects %o", (patch, field) => {
    const result = settingsInputSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path[0]).toBe(field);
  });
});
