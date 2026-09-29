import { describe, expect, it } from "vitest";
import { isAdminEmail, isOrgEmail, roleForEmail } from "@/features/auth/roles";
import { authPath, loginPathFor, safeNextPath } from "@/features/auth/safe-next";
import { authErrorMessage, googleErrorMessage } from "@/features/auth/auth-errors";

describe("organisation domain", () => {
  it.each(["jane@firstmate.tech", "JANE@FirstMate.Tech", "  jane.doe@firstmate.tech "])(
    "allows %s",
    (email) => {
      expect(isOrgEmail(email)).toBe(true);
    },
  );

  it.each([
    "jane@gmail.com",
    "jane@anothercompany.com",
    "jane@firstmate.tech.evil.com",
    "jane@evilfirstmate.tech",
    "jane@sub.firstmate.tech",
    "firstmate.tech",
    "@firstmate.tech",
    "jane@firstmate.tech@gmail.com",
    "jane @firstmate.tech",
    "jane+alt@firstmate.tech",
  ])("rejects %s", (email) => {
    expect(isOrgEmail(email)).toBe(false);
  });
});

describe("admin allow-list", () => {
  it("admin@firstmate.tech is the only Admin", () => {
    expect(isAdminEmail("admin@firstmate.tech")).toBe(true);
    expect(isAdminEmail("ADMIN@firstmate.tech")).toBe(true);
    expect(roleForEmail("admin@firstmate.tech")).toBe("admin");
  });

  it("everyone else is a Team Member", () => {
    expect(roleForEmail("jane@firstmate.tech")).toBe("member");
    expect(isAdminEmail("admin@firstmate.tech.evil.com")).toBe(false);
    expect(isAdminEmail("admin+x@firstmate.tech")).toBe(false);
  });
});

describe("safeNextPath (post-login redirect)", () => {
  it("keeps the QR return destination", () => {
    expect(safeNextPath("/attendance?source=qr")).toBe("/attendance?source=qr");
    expect(safeNextPath(encodeURIComponent("/attendance?source=qr"))).toBe("/attendance?source=qr");
  });

  it("allows admin paths", () => {
    expect(safeNextPath("/admin/settings")).toBe("/admin/settings");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "/login",
    "/attendance-evil",
    "/%2F%2Fevil.com",
    "/attendance/../../evil",
    "/attendance\nset-cookie",
  ])("falls back to /attendance for %s", (value) => {
    expect(safeNextPath(value)).toBe("/attendance");
  });

  it("builds login URLs that preserve the destination", () => {
    expect(loginPathFor("/attendance?source=qr")).toBe("/login?next=%2Fattendance%3Fsource%3Dqr");
    expect(loginPathFor("/attendance")).toBe("/login");
    expect(authPath("/login/admin", "/admin/settings")).toBe("/login/admin?next=%2Fadmin%2Fsettings");
    expect(authPath("/login", "//evil.com")).toBe("/login");
  });
});

describe("auth error copy", () => {
  it("maps Admin password errors to plain language", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toMatch(/don't match/);
    expect(authErrorMessage({ code: "USE_GOOGLE_SIGN_IN", status: 403 })).toMatch(/sign in with Google/);
    expect(authErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ status: 0 })).toMatch(/You're offline/);
  });

  it("explains Google sign-in failures", () => {
    expect(googleErrorMessage(undefined)).toBeUndefined();
    expect(googleErrorMessage("EMAIL_DOMAIN_NOT_ALLOWED")).toMatch(/@firstmate\.tech Google Workspace/);
    expect(googleErrorMessage("unable_to_get_user_info")).toMatch(/@firstmate\.tech Google Workspace/);
    expect(googleErrorMessage("account_not_linked")).toMatch(/can't use Google sign-in/);
    expect(googleErrorMessage("access_denied")).toMatch(/cancelled/);
    expect(googleErrorMessage("something_else")).toMatch(/didn't complete/);
  });
});
