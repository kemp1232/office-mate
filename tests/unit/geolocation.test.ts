import { describe, expect, it, vi } from "vitest";
import { NO_RESPONSE_GRACE_MS, requestBestPosition } from "@/features/attendance/geolocation";
import { detectPlatform, errorMessage, locatingMessage } from "@/features/attendance/messages";

type Reading = { accuracy: number } | { error: 1 | 2 | 3 };

/** A fake Geolocation that returns the given readings in order (and counts calls). */
function fakeGeo(readings: Reading[]) {
  const calls: PositionOptions[] = [];
  const geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback, fail: PositionErrorCallback, opts: PositionOptions) => {
      calls.push(opts);
      const r = readings[Math.min(calls.length - 1, readings.length - 1)];
      if ("error" in r) fail({ code: r.error } as GeolocationPositionError);
      else
        ok({ coords: { latitude: 14.55, longitude: 121.02, accuracy: r.accuracy } } as GeolocationPosition);
    }),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  return { geo, calls };
}

describe("requestBestPosition (one attempt per tap)", () => {
  it("stops after the first reading when it's already accurate enough", async () => {
    const { geo, calls } = fakeGeo([{ accuracy: 12 }]);
    const result = await requestBestPosition({ targetAccuracyM: 50 }, geo);
    expect(result).toMatchObject({ ok: true, position: { accuracy: 12 } });
    expect(calls).toHaveLength(1);
  });

  it("takes more readings while a just-woken GPS improves, reporting progress", async () => {
    const { geo, calls } = fakeGeo([{ accuracy: 180 }, { accuracy: 65 }, { accuracy: 22 }]);
    const progress: number[] = [];
    const result = await requestBestPosition(
      { targetAccuracyM: 50, onReading: (a) => progress.push(a) },
      geo,
    );
    expect(result).toMatchObject({ ok: true, position: { accuracy: 22 } });
    expect(progress).toEqual([180, 65, 22]);
    expect(calls).toHaveLength(3);
  });

  it("never exceeds the reading limit and returns the best reading even if it isn't good enough", async () => {
    const { geo, calls } = fakeGeo([
      { accuracy: 120 },
      { accuracy: 90 },
      { accuracy: 140 },
      { accuracy: 10 },
    ]);
    const result = await requestBestPosition({ targetAccuracyM: 50 }, geo);
    expect(result).toMatchObject({ ok: true, position: { accuracy: 90 } });
    expect(calls).toHaveLength(3);
  });

  it("recovers when the first reading times out or is unavailable", async () => {
    const { geo } = fakeGeo([{ error: 3 }, { error: 2 }, { accuracy: 30 }]);
    await expect(requestBestPosition({ targetAccuracyM: 50 }, geo)).resolves.toMatchObject({
      ok: true,
      position: { accuracy: 30 },
    });
  });

  it("stops immediately when permission is denied", async () => {
    const { geo, calls } = fakeGeo([{ error: 1 }, { accuracy: 10 }]);
    await expect(requestBestPosition({ targetAccuracyM: 50 }, geo)).resolves.toEqual({
      ok: false,
      kind: "PERMISSION_DENIED",
    });
    expect(calls).toHaveLength(1);
  });

  it("reports the last error when no reading ever arrives", async () => {
    const { geo } = fakeGeo([{ error: 3 }]);
    await expect(requestBestPosition({ targetAccuracyM: 50 }, geo)).resolves.toEqual({
      ok: false,
      kind: "TIMEOUT",
    });
  });

  it("respects the time budget and never uses watchPosition", async () => {
    let t = 0;
    const { geo, calls } = fakeGeo([{ accuracy: 200 }]);
    const slowGeo = {
      ...geo,
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback, opts: PositionOptions) => {
        t += 12_000; // each reading takes 12 s
        geo.getCurrentPosition(ok, fail, opts);
      },
    } as unknown as Geolocation;
    const result = await requestBestPosition({ targetAccuracyM: 50, budgetMs: 20_000 }, slowGeo, () => t);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2); // 0 s and 12 s; at 24 s the budget is spent
    expect(calls[1].timeout).toBe(8_000); // second reading only gets the remaining budget
    expect(calls.every((c) => c.enableHighAccuracy && c.maximumAge === 0)).toBe(true);
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });
});

describe("a browser that never answers (iPhone with Location off for the app)", () => {
  function silentGeo() {
    const late: { ok?: PositionCallback } = {};
    const geo = {
      getCurrentPosition: vi.fn((ok: PositionCallback) => {
        late.ok = ok; // never called back… until maybe much later
      }),
      watchPosition: vi.fn(),
    } as unknown as Geolocation;
    return { geo, late };
  }

  it("ends the attempt with NO_RESPONSE instead of loading forever", async () => {
    vi.useFakeTimers();
    try {
      const { geo } = silentGeo();
      const pending = requestBestPosition({ targetAccuracyM: 50 }, geo);
      await vi.advanceTimersByTimeAsync(15_000 + NO_RESPONSE_GRACE_MS.firstReading);
      await expect(pending).resolves.toEqual({ ok: false, kind: "NO_RESPONSE" });
      // Retrying a silent browser just makes people wait longer: one reading, then stop.
      expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(geo.watchPosition).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a callback that arrives after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { geo, late } = silentGeo();
      const pending = requestBestPosition({ targetAccuracyM: 50 }, geo);
      await vi.advanceTimersByTimeAsync(60_000);
      late.ok?.({ coords: { latitude: 1, longitude: 2, accuracy: 5 } } as GeolocationPosition);
      await expect(pending).resolves.toEqual({ ok: false, kind: "NO_RESPONSE" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells iPhone users where to allow location for their browser", () => {
    const message = errorMessage("CLOCK_IN", { kind: "NO_RESPONSE" }, "ios");
    expect(message.retry).toBe(true);
    expect(message.detail).toMatch(/Location Services.*Chrome or Safari.*While Using the App/);
  });
});

describe("location help copy", () => {
  it("detects the phone platform", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 8)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });

  it("tells people how to turn Location on for their phone", () => {
    expect(errorMessage("CLOCK_IN", { kind: "PERMISSION_DENIED" }, "ios").detail).toMatch(
      /Location Services/,
    );
    expect(errorMessage("CLOCK_IN", { kind: "PERMISSION_DENIED" }, "android").detail).toMatch(/swipe down/);
    expect(errorMessage("CLOCK_OUT", { kind: "POSITION_UNAVAILABLE" }, "ios").detail).toMatch(
      /Location Services is on/,
    );
    expect(errorMessage("CLOCK_IN", { kind: "PERMISSION_DENIED" }).title).toBe(
      "Location access is required to clock in",
    );
  });

  it("shows accuracy progress while the phone improves its fix", () => {
    expect(locatingMessage().detail).toBeUndefined();
    expect(locatingMessage(85.4).detail).toBe("Improving accuracy · 85m");
  });
});
