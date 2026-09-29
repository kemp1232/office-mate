import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: if there is no session cookie at all, send the visitor to login
 * and remember where they were going (e.g. /attendance?source=qr from the office QR code).
 * Real authentication/authorisation happens in the DAL on every page and Server Action.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/attendance/:path*", "/admin/:path*"],
};
