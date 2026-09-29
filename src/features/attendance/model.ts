import type { AttendanceAction, AttendanceState, ClockResult } from "./types";

/**
 * Client-side UI state for the single Attendance screen.
 * Pure reducer: the server remains authoritative for the persisted state and next action;
 * this only models the transient "checking / verifying / error" phases around one tap.
 */

export type GeoErrorKind = "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED";

export type AttemptError =
  | { kind: GeoErrorKind }
  | { kind: "ACCURACY_TOO_LOW"; accuracyM: number; thresholdM: number }
  | { kind: "OUTSIDE_GEOFENCE"; distanceM: number; radiusM: number }
  /** `unconfirmed`: the request may have reached the server; we can't say nothing was recorded. */
  | { kind: "OFFLINE"; unconfirmed: boolean }
  | { kind: "NOT_CONFIGURED" }
  | { kind: "SIGNED_OUT" }
  | { kind: "SERVER_ERROR" };

export type Phase =
  | { name: "idle" }
  | { name: "locating"; action: AttendanceAction }
  | { name: "verifying"; action: AttendanceAction; accuracyM: number }
  | { name: "success"; action: AttendanceAction; accuracyM: number }
  | { name: "error"; action: AttendanceAction; error: AttemptError }
  /** The server state had moved on (e.g. an earlier request did succeed); explain, don't act. */
  | { name: "synced"; action: AttendanceAction };

export type ScreenState = {
  attendance: AttendanceState;
  phase: Phase;
};

export type ScreenEvent =
  | { type: "START"; action: AttendanceAction }
  | { type: "LOCATED"; accuracyM: number }
  | { type: "GEO_FAILED"; kind: GeoErrorKind }
  | { type: "OFFLINE"; unconfirmed?: boolean }
  | { type: "RESULT"; result: ClockResult }
  | { type: "DISMISS" }
  | { type: "SYNC"; attendance: AttendanceState; attempted?: AttendanceAction };

export function initialScreenState(attendance: AttendanceState): ScreenState {
  return { attendance, phase: { name: "idle" } };
}

export function isBusy(phase: Phase): boolean {
  return phase.name === "locating" || phase.name === "verifying";
}

/** Whether a tap on `action` may start an attempt (same rule the reducer applies to START). */
export function canStart(state: ScreenState, action: AttendanceAction): boolean {
  return !isBusy(state.phase) && state.attendance.configured && state.attendance.next_action === action;
}

export function screenReducer(state: ScreenState, event: ScreenEvent): ScreenState {
  const { phase } = state;
  switch (event.type) {
    case "START":
      // Ignore repeated taps while an attempt is running, and never start an action
      // other than the one the server says is next.
      if (!canStart(state, event.action)) return state;
      return { ...state, phase: { name: "locating", action: event.action } };
    case "LOCATED":
      if (phase.name !== "locating") return state;
      return { ...state, phase: { name: "verifying", action: phase.action, accuracyM: event.accuracyM } };
    case "GEO_FAILED":
      if (phase.name !== "locating") return state;
      return { ...state, phase: { name: "error", action: phase.action, error: { kind: event.kind } } };
    case "OFFLINE":
      if (phase.name !== "locating" && phase.name !== "verifying") return state;
      return {
        ...state,
        phase: {
          name: "error",
          action: phase.action,
          error: { kind: "OFFLINE", unconfirmed: event.unconfirmed ?? false },
        },
      };
    case "RESULT":
      if (phase.name !== "verifying") return state;
      return applyResult(state, phase.action, event.result);
    case "DISMISS":
      return isBusy(phase) ? state : { ...state, phase: { name: "idle" } };
    case "SYNC": {
      if (isBusy(phase)) return state;
      // If the user's attempted action is no longer the next one, it was already recorded (or the
      // day changed): say so instead of silently swapping the button.
      if (event.attempted && event.attendance.next_action !== event.attempted) {
        return { attendance: event.attendance, phase: { name: "synced", action: event.attempted } };
      }
      return { attendance: event.attendance, phase: phase.name === "error" ? phase : { name: "idle" } };
    }
  }
}

function applyResult(state: ScreenState, action: AttendanceAction, result: ClockResult): ScreenState {
  if (result.ok) {
    return {
      attendance: result.state,
      phase: { name: "success", action: result.eventType, accuracyM: result.accuracyM },
    };
  }
  const fail = (error: AttemptError): ScreenState => ({
    ...state,
    phase: { name: "error", action, error },
  });
  switch (result.code) {
    case "ACCURACY_TOO_LOW":
      return fail({ kind: "ACCURACY_TOO_LOW", accuracyM: result.accuracyM, thresholdM: result.thresholdM });
    case "OUTSIDE_GEOFENCE":
      return fail({ kind: "OUTSIDE_GEOFENCE", distanceM: result.distanceM, radiusM: result.radiusM });
    case "STATE_CHANGED":
      // Our view was stale (e.g. a retried request already succeeded): show the real state and why.
      return { attendance: result.state, phase: { name: "synced", action } };
    case "NOT_CONFIGURED":
      return {
        attendance: { ...state.attendance, configured: false },
        phase: { name: "error", action, error: { kind: "NOT_CONFIGURED" } },
      };
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return fail({ kind: "SIGNED_OUT" });
    case "INVALID_INPUT":
    case "SERVER_ERROR":
      return fail({ kind: "SERVER_ERROR" });
  }
}
