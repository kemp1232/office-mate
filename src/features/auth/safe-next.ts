/**
 * Sanitises a post-login return path so it can only point inside this app.
 * Rejects absolute URLs, protocol-relative `//host`, backslash tricks and control chars.
 */
export const DEFAULT_AFTER_LOGIN = "/attendance";

const ALLOWED_PREFIXES = ["/attendance", "/admin"];

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_LOGIN;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return DEFAULT_AFTER_LOGIN;
  }
  // Resolve against a dummy origin to normalise `/./`, `/../` etc. and confirm same-origin.
  const url = new URL(value, "http://internal.invalid");
  if (url.origin !== "http://internal.invalid") return DEFAULT_AFTER_LOGIN;
  const path = url.pathname + url.search;
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
  return allowed ? path : DEFAULT_AFTER_LOGIN;
}

/**
 * Builds an auth page URL that carries the post-login destination, e.g.
 * `/login?next=%2Fattendance%3Fsource%3Dqr`. The default destination is omitted.
 */
export function authPath(
  base: "/login" | "/login/admin",
  next: string,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams(extra);
  const safe = safeNextPath(next);
  if (safe !== DEFAULT_AFTER_LOGIN) params.set("next", safe);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Builds `/login?next=…` for a protected path (preserves e.g. `?source=qr`). */
export function loginPathFor(pathWithQuery: string): string {
  return authPath("/login", pathWithQuery);
}
