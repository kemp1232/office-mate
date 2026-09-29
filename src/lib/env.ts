import "server-only";
import { z } from "zod";

/**
 * Server-only configuration, validated once. None of these are exposed to the browser
 * (no NEXT_PUBLIC_ prefix), and none are Admin-editable.
 */
const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  ATTENDANCE_TIMEZONE: z
    .string()
    .default("Asia/Manila")
    .refine(isValidTimeZone, "ATTENDANCE_TIMEZONE must be an IANA timezone"),
  // Google OAuth client (Google Cloud Console → Credentials). Optional locally: without it only
  // the Admin password sign-in works.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  // Google service account used to write attendance into the report Google Sheet (share the Sheet
  // with this email as Editor). Optional: without it, sync is simply off and events queue up.
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_SERVICE_ACCOUNT_KEY: optionalString,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
