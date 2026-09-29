import {
  ADMIN_TEST_PASSWORD,
  adminSignIn,
  adminUser,
  expect,
  newMember,
  signInAs,
  startGoogleSignIn,
  test,
  E2E_ORIGIN,
} from "./fixtures";
import { createUser } from "../support/db";

const origin = { origin: E2E_ORIGIN };

test.describe("Team Member sign-in (Google Workspace SSO)", () => {
  test("the login page offers Google first, Admin sign-in second, and no password form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin sign in" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("Google sign-in is restricted to the firstmate.tech Workspace and returns to Attendance", async ({
    page,
  }) => {
    await page.goto("/login");
    await startGoogleSignIn(page, "/attendance");
  });

  test("open-redirect attempts are dropped before the Google round trip", async ({ page }) => {
    await page.goto("/login?next=%2F%2Fevil.example.com");
    await startGoogleSignIn(page, "/attendance");
  });

  test("rejected Google accounts get a plain explanation", async ({ page }) => {
    for (const code of ["EMAIL_DOMAIN_NOT_ALLOWED", "unable_to_get_user_info"]) {
      await page.goto(`/login?error=${code}`);
      await expect(page.getByText("Use your @firstmate.tech Google Workspace account.")).toBeVisible();
    }
    await page.goto("/login?error=account_not_linked");
    await expect(page.getByText(/signs in with email and password — use Admin sign in/)).toBeVisible();
  });

  test("members can't use passwords, and self sign-up / email flows don't exist", async ({ request, db }) => {
    const member = await newMember(db);
    const signIn = await request.post("/api/auth/sign-in/email", {
      headers: origin,
      data: { email: member.email, password: "anything-at-all-123" },
    });
    expect(signIn.status()).toBe(403);
    expect((await signIn.json()).code).toBe("USE_GOOGLE_SIGN_IN");

    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/request-password-reset",
      "/api/auth/send-verification-email",
      "/api/auth/change-password",
      "/api/auth/update-user",
      "/api/auth/link-social",
    ]) {
      const res = await request.post(path, {
        headers: origin,
        data: { email: "x@firstmate.tech", name: "X", password: "whatever-123456" },
      });
      expect(res.status(), path).toBe(404);
    }
    const page = await request.get("/signup");
    expect(page.status()).toBe(404);
  });

  test("sign out ends the session", async ({ page, db }) => {
    const member = await newMember(db);
    await signInAs(page, db, member);
    await expect(page).toHaveURL(/\/attendance$/);
    await page.getByRole("button", { name: `Sign out ${member.email}` }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/attendance");
    await expect(page).toHaveURL(/\/login\?next=%2Fattendance$/);
  });
});

test.describe("Admin sign-in (email + password)", () => {
  test("wrong password shows a plain message", async ({ page, db }) => {
    const admin = await adminUser(db);
    await adminSignIn(page, admin.email, "not-the-password-123");
    await expect(page.getByText("That email and password don't match.")).toBeVisible();
    await expect(page).toHaveURL(/\/login\/admin/);
  });

  test("a Team Member address is refused on the Admin form", async ({ page, db }) => {
    const member = await newMember(db);
    await adminSignIn(page, member.email, "some-password-123");
    await expect(page.getByText("Team Members sign in with Google, not a password.")).toBeVisible();
  });

  test("the Admin gets Admin access and keeps the return path", async ({ page, db }) => {
    const admin = await adminUser(db);
    await adminSignIn(page, admin.email, ADMIN_TEST_PASSWORD, "/admin/settings");
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole("heading", { name: "Attendance settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin settings" })).toBeVisible();
  });
});

test.describe("authorisation", () => {
  test("Team Members can't open Admin pages", async ({ page, db }) => {
    const member = await newMember(db);
    await signInAs(page, db, member);
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.getByRole("link", { name: "Admin settings" })).toHaveCount(0);
    for (const path of ["/admin", "/admin/settings", "/admin/qr"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/attendance$/);
    }
  });

  test("a browser can't make itself Admin", async ({ page, context, db }) => {
    const member = await newMember(db);
    await signInAs(page, db, member);
    await expect(page).toHaveURL(/\/attendance$/);
    await context.addCookies([
      { name: "role", value: "admin", url: E2E_ORIGIN },
      { name: "isAdmin", value: "true", url: E2E_ORIGIN },
    ]);
    await page.goto("/admin/settings?role=admin");
    await expect(page).toHaveURL(/\/attendance$/);
  });

  test("unauthenticated requests to protected pages and actions are denied", async ({ request }) => {
    const page = await request.get("/attendance?source=qr", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(page.headers().location).toContain("/login?next=%2Fattendance%3Fsource%3Dqr");
    const action = await request.post("/attendance", {
      maxRedirects: 0,
      headers: { "next-action": "0".repeat(42), ...origin },
      data: "[]",
    });
    expect(action.status()).toBe(307);
    const settings = await request.get("/admin/settings", { maxRedirects: 0 });
    expect(settings.status()).toBe(307);
  });

  test("an account whose email isn't verified can't use the app, even with a session", async ({
    page,
    db,
  }) => {
    const user = await createUser(db, { verified: false });
    await signInAs(page, db, user);
    await expect(page).toHaveURL(/\/login/);
  });
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["permissions-policy"]).toContain("geolocation=(self)");
  expect(h["x-powered-by"]).toBeUndefined();
});
