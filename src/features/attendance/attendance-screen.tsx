"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  CircleCheckBig,
  ClockArrowDown,
  ClockArrowUp,
  LogIn,
  MapPin,
  RotateCw,
  Settings,
} from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { StatusPanel } from "@/components/ui/status-panel";
import { loginPathFor } from "@/features/auth/safe-next";
import { clockAction, refreshStateAction } from "./actions";
import { formatAttendanceDay, formatClockTime, formatElapsed, orgDate } from "./format";
import { requestCurrentPosition } from "./geolocation";
import {
  actionLabel,
  errorMessage,
  LOCATING_MESSAGE,
  successMessage,
  syncedMessage,
  verifyingMessage,
  type StatusMessage,
} from "./messages";
import { canStart, initialScreenState, isBusy, screenReducer, type ScreenState } from "./model";
import type { AttendanceAction, AttendanceSource, AttendanceState } from "./types";

type Props = {
  initialState: AttendanceState;
  source: AttendanceSource;
  firstName: string;
  isAdmin: boolean;
  serverNow: string;
};

export function AttendanceScreen({ initialState, source, firstName, isAdmin, serverNow }: Props) {
  const [screen, dispatch] = useReducer(screenReducer, initialState, initialScreenState);
  const { attendance, phase } = screen;
  const busy = isBusy(phase);
  const latest = useRef(screen);
  const running = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const inflight = useRef<Promise<AttendanceState | null> | null>(null);

  useEffect(() => {
    latest.current = screen;
  });

  /** Re-reads the authoritative state. `attempted` explains a state that moved past the user's tap. */
  const resync = useCallback(async (attempted?: AttendanceAction) => {
    // visibilitychange + pageshow often fire together: share one request.
    inflight.current ??= refreshStateAction()
      .catch(() => null)
      .finally(() => {
        inflight.current = null;
      });
    const fresh = await inflight.current;
    if (fresh) dispatch({ type: "SYNC", attendance: fresh, attempted });
    return fresh;
  }, []);
  const resyncIfIdle = useCallback(() => {
    if (!running.current) void resync();
  }, [resync]);

  // Keep the screen current when the PWA resumes / the tab becomes visible, and when the org day
  // rolls over while the app is open. This only re-reads state; it never touches location.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === "visible") resyncIfIdle();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
    };
  }, [resyncIfIdle]);

  // When the action button goes away (day complete), move focus to the summary.
  useEffect(() => {
    if (phase.name === "success" && attendance.next_action === "DAY_COMPLETE") cardRef.current?.focus();
  }, [phase.name, attendance.next_action]);

  async function attempt(action: AttendanceAction) {
    // Guard against double taps and stale state before React re-renders.
    if (running.current || !canStart(latest.current, action)) return;
    running.current = true;
    dispatch({ type: "START", action });
    let sent = false;
    try {
      if (!navigator.onLine) {
        dispatch({ type: "OFFLINE" });
        return;
      }
      // The ONLY place location is requested: once, in response to this tap.
      const located = await requestCurrentPosition();
      if (!located.ok) {
        dispatch({ type: "GEO_FAILED", kind: located.kind });
        return;
      }
      dispatch({ type: "LOCATED", accuracyM: located.position.accuracy });
      sent = true;
      const result = await clockAction({
        latitude: located.position.latitude,
        longitude: located.position.longitude,
        accuracy: located.position.accuracy,
        source,
        expectedAction: action,
      });
      dispatch({ type: "RESULT", result });
    } catch {
      // A failed request never becomes a success and nothing is queued. If the request may
      // have reached the server, check what actually happened before explaining.
      dispatch({ type: "OFFLINE", unconfirmed: sent });
      if (sent) await resync(action);
    } finally {
      running.current = false;
    }
  }

  async function retry() {
    if (phase.name !== "error" || running.current) return;
    const action = phase.action;
    running.current = true;
    // An earlier request may have succeeded after all: never turn a retry into a different action.
    const fresh = await resync(action);
    running.current = false;
    if (fresh && fresh.next_action !== action) return;
    dispatch({ type: "DISMISS" });
    await attempt(action);
  }

  const message = phaseMessage(screen);
  const nextAction = attendance.next_action;
  const signedOut = phase.name === "error" && phase.error.kind === "SIGNED_OUT";
  const showRetry = phase.name === "error" && Boolean(message?.retry);
  // The action the big button performs: the retried one, or the server-derived next action.
  const buttonAction = phase.name === "error" && showRetry ? phase.action : nextAction;

  // Portrait: greeting → today card (centred in the free space) → status + action anchored in
  // the thumb zone, so the button never moves when a message appears. Short landscape: 2 columns.
  return (
    <div className="mx-auto flex w-full max-w-(--container-attendance) flex-1 flex-col gap-5 pt-5 pb-4 sm:pt-8 short-landscape:max-w-3xl short-landscape:flex-row short-landscape:items-center short-landscape:gap-8 short-landscape:pt-4">
      <div className="flex flex-1 flex-col gap-5 short-landscape:self-stretch">
        <div>
          <Eyebrow>{formatAttendanceDay(attendance.attendance_day)}</Eyebrow>
          <h1 className="mt-1 text-2xl tracking-tight">Hi, {firstName}</h1>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          {attendance.configured ? (
            <TodayCard
              ref={cardRef}
              attendance={attendance}
              serverNow={serverNow}
              showHint={phase.name === "idle"}
            />
          ) : (
            <NotConfigured isAdmin={isAdmin} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 short-landscape:flex-1">
        {/* Always mounted so screen readers announce changes. */}
        <div role="status" aria-live="polite" aria-atomic="true">
          {message ? <StatusPanel key={`${phase.name}-${message.title}`} compact {...message} /> : null}
        </div>

        {signedOut ? (
          <LinkButton
            size="cta"
            href={loginPathFor(source === "QR" ? "/attendance?source=qr" : "/attendance")}
            icon={<LogIn aria-hidden className="size-6" />}
          >
            Sign in again
          </LinkButton>
        ) : attendance.configured && buttonAction !== "DAY_COMPLETE" ? (
          <>
            <Button
              size="cta"
              variant={buttonAction === "CLOCK_OUT" ? "clock-out" : "primary"}
              onClick={showRetry ? retry : () => attempt(buttonAction)}
              // aria-disabled (not disabled) keeps keyboard/screen-reader focus on the button.
              aria-disabled={busy || undefined}
              icon={
                showRetry ? <RotateCw aria-hidden className="size-6" /> : <ActionIcon action={buttonAction} />
              }
            >
              {showRetry
                ? `Try ${actionLabel(buttonAction)} again`
                : busy
                  ? "Checking location…"
                  : actionLabel(buttonAction)}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-sm text-ink-muted">
              <MapPin aria-hidden className="size-4 shrink-0" />
              Your location is checked once, only when you tap.
            </p>
          </>
        ) : null}

        {!attendance.configured ? (
          <Button size="cta" disabled icon={<ActionIcon action="CLOCK_IN" />}>
            Clock In
          </Button>
        ) : null}
      </div>
      <DayRollover day={attendance.attendance_day} timezone={attendance.timezone} onRollover={resyncIfIdle} />
    </div>
  );
}

function ActionIcon({ action }: { action: AttendanceAction }) {
  const Icon = action === "CLOCK_IN" ? ClockArrowUp : ClockArrowDown;
  return <Icon aria-hidden className="size-6" />;
}

function phaseMessage({ phase, attendance }: ScreenState): StatusMessage | null {
  switch (phase.name) {
    case "idle":
      return null;
    case "locating":
      return LOCATING_MESSAGE;
    case "verifying":
      return verifyingMessage(phase.accuracyM);
    case "success":
      return successMessage(phase.action, attendance, phase.accuracyM);
    case "synced":
      return syncedMessage(phase.action, attendance);
    case "error":
      return errorMessage(phase.action, phase.error);
  }
}

function TodayCard({
  ref,
  attendance,
  serverNow,
  showHint,
}: {
  ref: React.Ref<HTMLElement>;
  attendance: AttendanceState;
  serverNow: string;
  showHint: boolean;
}) {
  const { next_action, clock_in_at, clock_out_at, timezone } = attendance;
  const clockedIn = next_action === "CLOCK_OUT" && clock_in_at;
  const className =
    next_action === "CLOCK_IN"
      ? "border border-stroke bg-surface px-5 py-6 text-center"
      : clockedIn
        ? "animate-rise-in bg-night px-5 py-7 text-center text-ink-inverse"
        : "animate-rise-in border border-stroke bg-surface p-5";

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label="Today's attendance"
      className={`rounded-card transition-colors duration-(--duration-base) ${className}`}
    >
      {next_action === "CLOCK_IN" ? (
        <>
          <p className="text-sm font-bold text-ink-muted">Today</p>
          <p className="mt-1 text-xl font-bold text-ink-strong">Not clocked in yet</p>
          {showHint ? (
            <p className="mt-1 text-sm text-ink-muted">Tap Clock In when you&apos;re at the office.</p>
          ) : null}
        </>
      ) : clockedIn ? (
        <>
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-success-bright">
            <ClockArrowUp aria-hidden className="size-4" /> Clocked in
          </p>
          <p className="mt-1 text-display font-bold tracking-tight tabular-nums">
            <time dateTime={clock_in_at}>{formatClockTime(clock_in_at, timezone)}</time>
          </p>
          <p className="mt-1 text-sm text-ink-inverse-muted">
            Elapsed <Elapsed since={clock_in_at} serverNow={serverNow} />
          </p>
        </>
      ) : (
        <>
          <p className="flex flex-col items-center gap-1.5 text-center text-lg font-bold text-ink-strong">
            <CircleCheckBig aria-hidden className="size-6 text-success" />
            Attendance complete for today
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
            {(
              [
                ["Clocked in", clock_in_at],
                ["Clocked out", clock_out_at],
              ] as const
            ).map(([label, at]) => (
              <div key={label} className="rounded-panel bg-surface-muted px-3 py-4">
                <dt className="text-sm text-ink-muted">{label}</dt>
                <dd className="mt-0.5 text-2xl font-bold text-ink-strong tabular-nums">
                  {at ? <time dateTime={at}>{formatClockTime(at, timezone)}</time> : "—"}
                </dd>
              </div>
            ))}
          </dl>
          {clock_in_at && clock_out_at ? (
            <p className="mt-3 text-center text-sm text-ink-muted">
              Total {formatElapsed(clock_in_at, clock_out_at)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function NotConfigured({ isAdmin }: { isAdmin: boolean }) {
  return (
    <StatusPanel
      tone={isAdmin ? "warning" : "neutral"}
      title={isAdmin ? "Attendance setup incomplete" : "Attendance isn't set up yet"}
      detail={
        isAdmin
          ? "Set the office location on the map before the team can clock in."
          : "An Admin needs to set the office location first. Please check back soon."
      }
    >
      {isAdmin ? (
        <LinkButton
          size="sm"
          href="/admin/settings"
          icon={<Settings aria-hidden className="size-5" />}
          className="mt-3"
        >
          Open settings
        </LinkButton>
      ) : null}
    </StatusPanel>
  );
}

/** Ticks every 30 s. Used only by the small components below, so the screen doesn't re-render. */
function useNow(initial?: string): Date {
  const [now, setNow] = useState(() => (initial ? new Date(initial) : new Date()));
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0); // correct any server/client clock gap right away
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  return now;
}

/** "3h 12m" since clock-in, updated live. Uses the clock only — never location. */
function Elapsed({ since, serverNow }: { since: string; serverNow: string }) {
  return <>{formatElapsed(since, useNow(serverNow))}</>;
}

/** Re-reads state when the org calendar day changes while the app stays open (e.g. past midnight). */
function DayRollover({
  day,
  timezone,
  onRollover,
}: {
  day: string;
  timezone: string;
  onRollover: () => void;
}) {
  const today = orgDate(useNow(), timezone);
  useEffect(() => {
    if (today !== day) onRollover();
  }, [today, day, onRollover]);
  return null;
}
