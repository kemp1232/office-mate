import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { env } from "./env";

/**
 * One Postgres pool per server instance, connecting as the least-privilege `attendance_app`
 * role. Uses unnamed statements only (compatible with Supabase's transaction pooler).
 */
const globalForDb = globalThis as unknown as { __attendancePool?: Pool };

export function db(): Pool {
  if (!globalForDb.__attendancePool) {
    const pool = new Pool({
      connectionString: env().DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // Lets Vercel Fluid compute release idle clients before an instance is suspended.
    attachDatabasePool(pool);
    globalForDb.__attendancePool = pool;
  }
  return globalForDb.__attendancePool;
}

/** Calls an `app.*` function that returns jsonb and yields the parsed value. */
export async function callJson<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db().query<{ result: T }>(sql, params);
  return rows[0].result;
}
