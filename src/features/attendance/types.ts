import { z } from "zod";

/** An action the user can attempt (never DAY_COMPLETE). */
export type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT";
export type AttendanceSource = "DIRECT" | "QR";

export const attendanceStateSchema = z.object({
  configured: z.boolean(),
  attendance_day: z.string(),
  timezone: z.string(),
  clock_in_at: z.string().nullable(),
  clock_out_at: z.string().nullable(),
  next_action: z.enum(["CLOCK_IN", "CLOCK_OUT", "DAY_COMPLETE"]),
  radius_m: z.number(),
  accuracy_threshold_m: z.number(),
});

export type AttendanceState = z.infer<typeof attendanceStateSchema>;

/** Result of an attendance attempt as returned to the client. */
export type ClockResult =
  | {
      ok: true;
      eventType: AttendanceAction;
      accuracyM: number;
      distanceM: number;
      state: AttendanceState;
    }
  | { ok: false; code: "ACCURACY_TOO_LOW"; accuracyM: number; thresholdM: number }
  | { ok: false; code: "OUTSIDE_GEOFENCE"; distanceM: number; radiusM: number }
  | { ok: false; code: "STATE_CHANGED"; state: AttendanceState }
  | {
      ok: false;
      code: "NOT_CONFIGURED" | "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "SERVER_ERROR";
    };

/** Validated payload the browser may send. Nothing else is accepted. */
export const clockInputSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().positive().max(100_000),
    source: z.enum(["DIRECT", "QR"]),
    expectedAction: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  })
  .strict();

export type ClockInput = z.infer<typeof clockInputSchema>;
