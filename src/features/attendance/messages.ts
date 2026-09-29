import { formatClockTime } from "./format";
import type { AttemptError } from "./model";
import type { AttendanceAction, AttendanceState } from "./types";

/** Plain-language copy for every attendance outcome. Wording follows the approved proposal. */

export type Tone = "neutral" | "success" | "warning" | "danger" | "progress";

export type StatusMessage = {
  tone: Tone;
  title: string;
  detail?: string;
  /** Whether the user can simply try again. */
  retry: boolean;
};

function verb(action: AttendanceAction): string {
  return action === "CLOCK_IN" ? "clock in" : "clock out";
}

export function actionLabel(action: AttendanceAction): string {
  return action === "CLOCK_IN" ? "Clock In" : "Clock Out";
}

function formatMeters(m: number): string {
  return `${Math.round(m).toLocaleString("en-US")}m`;
}

export type Platform = "ios" | "android" | "other";

/** Which phone OS to tailor "turn on Location" help for. */
export function detectPlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

export function locatingMessage(bestAccuracyM?: number): StatusMessage {
  return {
    tone: "progress",
    title: "Checking your location…",
    detail: bestAccuracyM === undefined ? undefined : `Improving accuracy · ${formatMeters(bestAccuracyM)}`,
    retry: false,
  };
}

const PERMISSION_HELP: Record<Platform, string> = {
  ios: "Turn on Settings › Privacy & Security › Location Services, allow it for your browser, then try again.",
  android:
    "Turn on Location (swipe down from the top), allow it for this site via the icon beside the address, then try again.",
  other: "Allow location for this site in your browser settings, then try again.",
};

const UNAVAILABLE_HELP: Record<Platform, string> = {
  ios: "Make sure Location Services is on (Settings › Privacy & Security), then try again near a window.",
  android: "Make sure Location is on (swipe down from the top), then try again near a window.",
  other: "Check that location services are on, then try again.",
};

export function verifyingMessage(accuracyM: number): StatusMessage {
  return {
    tone: "progress",
    title: "Verifying you're at the office…",
    detail: `${formatMeters(accuracyM)} accuracy`,
    retry: false,
  };
}

/** Confirms what was recorded (and when), then the verification detail from the proposal. */
export function successMessage(
  action: AttendanceAction,
  state: AttendanceState,
  accuracyM: number,
): StatusMessage {
  const at = action === "CLOCK_IN" ? state.clock_in_at : state.clock_out_at;
  const time = at ? ` at ${formatClockTime(at, state.timezone)}` : "";
  return {
    tone: "success",
    title: `${action === "CLOCK_IN" ? "Clocked in" : "Clocked out"}${time}`,
    detail: `You're at the office · Verified · ${formatMeters(accuracyM)} accuracy`,
    retry: false,
  };
}

/** Shown when the server state had already moved past the action the user tried. */
export function syncedMessage(attempted: AttendanceAction, state: AttendanceState): StatusMessage {
  const t = (iso: string | null) => (iso ? ` at ${formatClockTime(iso, state.timezone)}` : "");
  if (state.next_action === "CLOCK_OUT")
    return { tone: "neutral", title: `You're already clocked in${t(state.clock_in_at)}`, retry: false };
  if (state.next_action === "DAY_COMPLETE")
    return {
      tone: "neutral",
      title:
        attempted === "CLOCK_OUT"
          ? `You're already clocked out${t(state.clock_out_at)}`
          : "Attendance is already complete for today",
      retry: false,
    };
  return {
    tone: "neutral",
    title: "A new attendance day has started",
    detail: "Tap Clock In when you're at the office.",
    retry: false,
  };
}

export function errorMessage(
  action: AttendanceAction,
  error: AttemptError,
  platform: Platform = "other",
): StatusMessage {
  switch (error.kind) {
    case "PERMISSION_DENIED":
      return {
        tone: "danger",
        title: `Location access is required to ${verb(action)}`,
        detail: PERMISSION_HELP[platform],
        retry: true,
      };
    case "POSITION_UNAVAILABLE":
    case "TIMEOUT":
      return {
        tone: "warning",
        title: "Couldn't get your location",
        detail: UNAVAILABLE_HELP[platform],
        retry: true,
      };
    case "UNSUPPORTED":
      return {
        tone: "danger",
        title: "This browser can't share your location",
        detail: "Open this page in Safari or Chrome on your phone.",
        retry: false,
      };
    case "ACCURACY_TOO_LOW":
      return {
        tone: "warning",
        title: "We need a more accurate location. Try again near a window or outside.",
        detail: `${formatMeters(error.accuracyM)} accuracy · need ${formatMeters(error.thresholdM)} or better`,
        retry: true,
      };
    case "OUTSIDE_GEOFENCE":
      return {
        tone: "warning",
        title: "Outside the office area",
        detail: `${formatMeters(error.distanceM)} away · limit ${formatMeters(error.radiusM)}. You need to be within the office area to ${verb(action)}.`,
        retry: true,
      };
    case "OFFLINE":
      return {
        tone: "danger",
        title: "You're offline. Check your connection and try again.",
        detail: error.unconfirmed
          ? `We couldn't confirm your ${actionLabel(action)}. Trying again won't record it twice.`
          : undefined,
        retry: true,
      };
    case "NOT_CONFIGURED":
      return { tone: "neutral", title: "Attendance isn't set up yet", retry: false };
    case "SIGNED_OUT":
      return {
        tone: "danger",
        title: "Your session has ended",
        detail: "Sign in again to continue.",
        retry: false,
      };
    case "SERVER_ERROR":
      return {
        tone: "danger",
        title: "Something went wrong",
        detail: `We couldn't confirm your ${actionLabel(action)}. Trying again won't record it twice.`,
        retry: true,
      };
  }
}
