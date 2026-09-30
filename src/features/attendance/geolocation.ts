import type { GeoErrorKind } from "./model";

export type Position = { latitude: number; longitude: number; accuracy: number };

export type PositionResult = { ok: true; position: Position } | { ok: false; kind: GeoErrorKind };

const browserGeolocation = () => (typeof navigator === "undefined" ? undefined : navigator.geolocation);

/**
 * Browsers don't count time spent waiting on a permission prompt toward `timeout`, and some (Chrome
 * and Safari on iPhone when the app's Location setting is off or "Ask Next Time") never call back at
 * all. So every reading also has our own deadline: it always ends, and the screen never hangs on
 * "Checking your location…". The first reading gets extra time for a permission prompt.
 */
export const NO_RESPONSE_GRACE_MS = { firstReading: 15_000, later: 3_000 } as const;

/**
 * One `getCurrentPosition` reading. Called only from an explicit Clock In / Clock Out tap (or the
 * Admin's "Use my location"). Never use watchPosition or polling: attendance must not track location.
 */
export function requestCurrentPosition(
  geolocation: Geolocation | undefined = browserGeolocation(),
  timeoutMs = 15_000,
  graceMs: number = NO_RESPONSE_GRACE_MS.firstReading,
): Promise<PositionResult> {
  if (!geolocation) return Promise.resolve({ ok: false, kind: "UNSUPPORTED" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PositionResult) => {
      if (settled) return; // a late browser callback after our deadline is ignored
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    const deadline = setTimeout(() => finish({ ok: false, kind: "NO_RESPONSE" }), timeoutMs + graceMs);
    geolocation.getCurrentPosition(
      ({ coords }) =>
        finish({
          ok: true,
          position: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy },
        }),
      (error) => {
        const kind: GeoErrorKind =
          error.code === 1 ? "PERMISSION_DENIED" : error.code === 3 ? "TIMEOUT" : "POSITION_UNAVAILABLE";
        finish({ ok: false, kind });
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
    const result = await requestCurrentPosition(
      geolocation,
      Math.min(15_000, remaining),
      reading === 0 ? NO_RESPONSE_GRACE_MS.firstReading : NO_RESPONSE_GRACE_MS.later,
    );
    if (!result.ok) {
      // Retrying can't fix a refusal, a missing API, or a browser that isn't answering; stop now.
      if (
        result.kind === "PERMISSION_DENIED" ||
        result.kind === "UNSUPPORTED" ||
        result.kind === "NO_RESPONSE"
      )
        return result;
      lastError = result;
      continue;
    }
    if (!best || result.position.accuracy < best.accuracy) best = result.position;
    onReading?.(best.accuracy);
    if (best.accuracy <= targetAccuracyM) break;
  }
  return best ? { ok: true, position: best } : lastError;
}
