/**
 * Test-only database helpers (local Supabase). Uses the privileged DATABASE_ADMIN_URL for
 * fixtures and the least-privilege DATABASE_URL (attendance_app) for the code under test.
 * Attendance rows are immutable, so every test creates fresh users instead of cleaning up.
 */
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

export const OFFICE = { latitude: 14.5547, longitude: 121.0244 };
/** Degrees of latitude per metre on the IUGG mean sphere used by app.distance_m(). */
export const DEG_PER_M = 1 / 111195.08;

export function adminPool(max = 2) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
  return new pg.Pool({ connectionString: url, max });
}

export function appPool(max = 10) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return new pg.Pool({ connectionString: url, max });
}

/** A point `metres` due north of the office. */
export function officeOffset(metres: number) {
  return OFFICE.latitude + metres * DEG_PER_M;
}

// scrypt is deliberately slow; tests reuse the same few passwords.
const hashes = new Map<string, Promise<string>>();
const hashOnce = (password: string) => {
  if (!hashes.has(password)) hashes.set(password, hashPassword(password));
  return hashes.get(password)!;
};

export const ADMIN_TEST_PASSWORD = "admin-e2e-password-123";

/** The local Admin account (resets its password to ADMIN_TEST_PASSWORD — local DB only). */
export function adminUser(pool: pg.Pool) {
  return createUser(pool, { email: "admin@firstmate.tech", name: "Admin", password: ADMIN_TEST_PASSWORD });
}

export function uniqueEmail(prefix: string) {
  return `${prefix}.${randomUUID().slice(0, 8)}@firstmate.tech`;
}

/**
 * Inserts a verified (or unverified) user. With `password` it gets a Better Auth credential
 * account (the Admin); otherwise a Google account row, like a Team Member after Workspace SSO.
 */
export async function createUser(
  pool: pg.Pool,
  opts: { email?: string; name?: string; password?: string; verified?: boolean } = {},
) {
  const email = opts.email ?? uniqueEmail("test");
  const { rows } = await pool.query<{ id: string }>(
    `insert into app.users (name, email, email_verified, updated_at) values ($1, $2, $3, now())
     on conflict (email) do update set email_verified = excluded.email_verified
     returning id`,
    [opts.name ?? "Test User", email, opts.verified ?? true],
  );
  const id = rows[0].id;
  if (opts.password) {
    const hash = await hashOnce(opts.password);
    const updated = await pool.query(
      "update app.accounts set password = $2, updated_at = now() where user_id = $1::uuid and provider_id = 'credential'",
      [id, hash],
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `insert into app.accounts (account_id, provider_id, user_id, password, updated_at)
         values ($1::text, 'credential', $1::uuid, $2, now())`,
        [id, hash],
      );
    }
  } else {
    await pool.query(
      `insert into app.accounts (account_id, provider_id, user_id, updated_at)
       select $2, 'google', $1::uuid, now()
       where not exists (select 1 from app.accounts where user_id = $1::uuid and provider_id = 'google')`,
      [id, `google-sub-${randomUUID()}`],
    );
  }
  return { id, email, password: opts.password };
}

/**
 * Creates a Better Auth session for `userId` and returns its signed cookie value — the test
 * equivalent of completing Google sign-in (real Google OAuth can't run in automated tests).
 * Mirrors better-call's signCookieValue: `${token}.${base64(HMAC-SHA256(secret, token))}`.
 */
export async function sessionCookieFor(pool: pg.Pool, userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const token = randomUUID().replaceAll("-", "");
  await pool.query(
    `insert into app.sessions (expires_at, token, updated_at, user_id)
     values (now() + interval '1 day', $1, now(), $2::uuid)`,
    [token, userId],
  );
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return { name: "better-auth.session_token", value: encodeURIComponent(`${token}.${signature}`) };
}

export async function setSettings(
  pool: pg.Pool,
  s: {
    configured?: boolean;
    radiusM?: number;
    accuracyThresholdM?: number;
  } = {},
) {
  const configured = s.configured ?? true;
  await pool.query(
    `update app.attendance_settings set office_latitude = $1, office_longitude = $2,
       radius_m = $3, accuracy_threshold_m = $4, report_url = default, updated_at = now()`,
    [
      configured ? OFFICE.latitude : null,
      configured ? OFFICE.longitude : null,
      s.radiusM ?? 300,
      s.accuracyThresholdM ?? 50,
    ],
  );
}
