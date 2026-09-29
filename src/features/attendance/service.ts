import "server-only";
import { z } from "zod";
import { callJson } from "@/lib/db";
import { env } from "@/lib/env";
import { attendanceStateSchema, type AttendanceState, type ClockInput, type ClockResult } from "./types";

/**
 * Thin server wrapper over the database trust boundary (app.get_attendance_state /
 * app.record_attendance). All validation, the next-action decision, timestamps and the
 * attendance day are computed in Postgres. The timezone is server config, never client input.
 */

export async function getTodayState(userId: string): Promise<AttendanceState | null> {
  const result = await callJson<Record<string, unknown>>(
    "select app.get_attendance_state($1::uuid, $2) as result",
    [userId, env().ATTENDANCE_TIMEZONE],
  );
  if (result.ok !== true) return null;
  return attendanceStateSchema.parse(result);
}

const recordResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    event: z.object({
      event_type: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
      accuracy_m: z.number(),
      distance_m: z.number(),
    }),
    state: attendanceStateSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    accuracy_m: z.number().optional(),
    accuracy_threshold_m: z.number().optional(),
    distance_m: z.number().optional(),
    radius_m: z.number().optional(),
    state: attendanceStateSchema.optional(),
  }),
]);

export async function recordAttendance(userId: string, input: ClockInput): Promise<ClockResult> {
  const raw = await callJson("select app.record_attendance($1::uuid, $2, $3, $4, $5, $6, $7) as result", [
    userId,
    input.latitude,
    input.longitude,
    input.accuracy,
    input.source,
    input.expectedAction,
    env().ATTENDANCE_TIMEZONE,
  ]);
  const r = recordResultSchema.parse(raw);
  if (r.ok) {
    return {
      ok: true,
      eventType: r.event.event_type,
      accuracyM: r.event.accuracy_m,
      distanceM: r.event.distance_m,
      state: r.state,
    };
  }
  switch (r.code) {
    case "ACCURACY_TOO_LOW":
      return {
        ok: false,
        code: r.code,
        accuracyM: r.accuracy_m ?? 0,
        thresholdM: r.accuracy_threshold_m ?? 0,
      };
    case "OUTSIDE_GEOFENCE":
      return { ok: false, code: r.code, distanceM: r.distance_m ?? 0, radiusM: r.radius_m ?? 0 };
    case "STATE_CHANGED":
      return r.state ? { ok: false, code: r.code, state: r.state } : { ok: false, code: "SERVER_ERROR" };
    case "NOT_CONFIGURED":
    case "INVALID_INPUT":
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return { ok: false, code: r.code };
    default:
      return { ok: false, code: "SERVER_ERROR" };
  }
}
