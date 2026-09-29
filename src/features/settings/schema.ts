import { z } from "zod";

export const RADIUS_LIMITS = { min: 10, max: 5000, default: 300 } as const;
export const ACCURACY_LIMITS = { min: 5, max: 1000, default: 50 } as const;

export type AdminSettings = {
  officeLatitude: number | null;
  officeLongitude: number | null;
  radiusM: number;
  accuracyThresholdM: number;
  reportUrl: string;
  updatedAt: string;
};

/** Admin Settings form payload (validated again by DB constraints). */
export const settingsInputSchema = z
  .object({
    officeLatitude: z.number().finite().min(-90).max(90).nullable(),
    officeLongitude: z.number().finite().min(-180).max(180).nullable(),
    radiusM: z
      .number({ error: "Enter a radius in meters" })
      .int("Use a whole number of meters")
      .min(RADIUS_LIMITS.min, `At least ${RADIUS_LIMITS.min} m`)
      .max(RADIUS_LIMITS.max, `At most ${RADIUS_LIMITS.max} m`),
    accuracyThresholdM: z
      .number({ error: "Enter an accuracy threshold in meters" })
      .int("Use a whole number of meters")
      .min(ACCURACY_LIMITS.min, `At least ${ACCURACY_LIMITS.min} m`)
      .max(ACCURACY_LIMITS.max, `At most ${ACCURACY_LIMITS.max} m`),
    reportUrl: z
      .string()
      .trim()
      .max(2048, "That link is too long")
      .url("Enter a valid URL")
      .refine((v) => v.startsWith("https://"), "The link must start with https://"),
  })
  .strict()
  .refine((v) => (v.officeLatitude === null) === (v.officeLongitude === null), {
    message: "Place the office pin on the map",
    path: ["officeLatitude"],
  });

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export type SettingsFieldErrors = Partial<Record<keyof SettingsInput, string>>;

export type SaveSettingsResult =
  | { ok: true; settings: AdminSettings }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" | "SERVER_ERROR"; fieldErrors?: SettingsFieldErrors };
