import { config } from "dotenv";

/**
 * Loads `.env.test` (local Supabase only) over anything from the shell or `.env.local`, then refuses
 * to continue if a database URL isn't local — so tests can never write into a hosted project.
 */
export function loadTestEnv() {
  config({ path: ".env.test", override: true, quiet: true });
  for (const key of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
    const host = (process.env[key] ?? "").split("@").pop()?.split(/[:/]/)[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`${key} must point at the local Supabase for tests (got host "${host}")`);
    }
  }
}

/** Port for the E2E server — deliberately not 3000, so a dev server is never reused by tests. */
export const E2E_PORT = 3200;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
