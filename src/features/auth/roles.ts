/**
 * Organisation + role rules (v1). Not configurable at runtime.
 * The database enforces the same rules in app.team_member_email() / app.is_admin() / app.admin_emails();
 * tests/integration/attendance-db.test.ts keeps the two in sync.
 */
export const ORG_DOMAIN = "firstmate.tech";

/** Hard-coded Admin allow-list. There is no role-management UI. */
export const ADMIN_EMAILS: readonly string[] = ["admin@firstmate.tech"];

export type Role = "admin" | "member";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True only for a plain address whose domain is exactly the org domain. Plus-addressed aliases
 * (jane+x@) are rejected so each mailbox maps to one identity. Mirrors the DB constraint.
 */
export function isOrgEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const match = /^[^\s@+]+@([^\s@]+)$/.exec(normalized);
  return match !== null && match[1] === ORG_DOMAIN;
}

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function roleForEmail(email: string): Role {
  return isAdminEmail(email) ? "admin" : "member";
}
