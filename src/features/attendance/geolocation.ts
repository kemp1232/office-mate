import type { GeoErrorKind } from "./model";

export type Position = { latitude: number; longitude: number; accuracy: number };

export type PositionResult = { ok: true; position: Position } | { ok: false; kind: GeoErrorKind };

const browserGeolocation = () => (typeof navigator === "undefined" ? undefined : navigator.geolocation);

/**
 * One `getCurrentPosition` reading. Called only from an explicit Clock In / Clock Out tap (or the
 * Admin's "Use my location"). Never use watchPosition or polling: attendance must not track location.
 */
export function requestCurrentPosition(
  geolocation: Geolocation | undefined = browserGeolocation(),
  timeoutMs = 15_000,
): Promise<PositionResult> {
  if (!geolocation) return Promise.resolve({ ok: false, kind: "UNSUPPORTED" });
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          ok: true,
          position: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy },
        }),
      (error) => {
        const kind: GeoErrorKind =
          error.code === 1 ? "PERMISSION_DENIED" : error.code === 3 ? "TIMEOUT" : "POSITION_UNAVAILABLE";
        resolve({ ok: false, kind });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export type BestPositionOptions = {
  /** Stop as soon as a reading is at least this accurate (the org's accuracy threshold). */
  targetAccuracyM: number;
  /** At most this many readings for one tap. */
  maxReadings?: number;
  /** Give up after this long in total. */
  budgetMs?: number;
  /** Called with the best accuracy so far, for "improving accuracy" feedback. */
  onReading?: (accuracyM: number) => void;
};

/**
 * One location ATTEMPT for one tap. A phone that has just turned on Location usually returns a
 * rough network fix (or times out) before GPS warms up, so this takes up to `maxReadings`
 * sequential readings within `budgetMs`, stops early once one is accurate enough, and returns the
 * best. It ends when the attempt ends — nothing keeps running and nothing is watched in the background.
 */
export async function requestBestPosition(
  { targetAccuracyM, maxReadings = 3, budgetMs = 20_000, onReading }: BestPositionOptions,
  geolocation: Geolocation | undefined = browserGeolocation(),
  now: () => number = Date.now,
): Promise<PositionResult> {
  const deadline = now() + budgetMs;
  let best: Position | undefined;
  let lastError: PositionResult = { ok: false, kind: "POSITION_UNAVAILABLE" };

  for (let reading = 0; reading < maxReadings; reading++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const result = await requestCurrentPosition(geolocation, Math.min(15_000, remaining));
    if (!result.ok) {
      // Retrying can't fix a refusal or a missing API; stop immediately.
      if (result.kind === "PERMISSION_DENIED" || result.kind === "UNSUPPORTED") return result;
      lastError = result;
      continue;
    }
    if (!best || result.position.accuracy < best.accuracy) best = result.position;
    onReading?.(best.accuracy);
    if (best.accuracy <= targetAccuracyM) break;
  }
  return best ? { ok: true, position: best } : lastError;
}
