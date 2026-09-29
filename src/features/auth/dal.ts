import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { isOrgEmail, roleForEmail, type Role } from "./roles";
import { loginPathFor } from "./safe-next";

/**
 * Data Access Layer: the ONLY place pages and Server Actions learn who the user is.
 * The session is verified by Better Auth against the database on every request.
 * Role is derived from the verified email here — never read from the request.
 */
export type Viewer = { id: string; email: string; name: string; role: Role };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  if (!user.emailVerified || !isOrgEmail(user.email)) return null;
  return { id: user.id, email: user.email, name: user.name, role: roleForEmail(user.email) };
});

/** For pages: redirects to login (preserving the return path) when signed out. */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(loginPathFor(returnTo));
  return viewer;
}

/** For Admin pages: Team Members are sent back to Attendance. */
export async function requireAdminPage(returnTo: string): Promise<Viewer> {
  const viewer = await requireViewer(returnTo);
  if (viewer.role !== "admin") redirect("/attendance");
  return viewer;
}
