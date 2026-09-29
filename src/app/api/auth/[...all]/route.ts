import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// All sign-in / sign-up / verification / reset traffic goes through here so Better Auth's
// origin checks and rate limiting apply.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
