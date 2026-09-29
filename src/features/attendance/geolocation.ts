import type { GeoErrorKind } from "./model";

export type Position = { latitude: number; longitude: number; accuracy: number };

export type PositionResult = { ok: true; position: Position } | { ok: false; kind: GeoErrorKind };

/**
 * Requests the device location exactly ONCE. Called only from an explicit Clock In / Clock Out
 * tap. Never use watchPosition or polling here: attendance must not track location.
 */
export function requestCurrentPosition(
  geolocation: Geolocation | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
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
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}
