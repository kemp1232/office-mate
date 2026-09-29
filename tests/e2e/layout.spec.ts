import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import {
  adminUser,
  configureOffice,
  expect,
  inside,
  installGeoStub,
  newMember,
  test,
  snap,
  mapReady,
  settle,
  signInAs,
  adminSignIn,
  ADMIN_TEST_PASSWORD,
} from "./fixtures";

/**
 * Layout guardrails on every device project: no horizontal scroll, comfortable touch targets,
 * primary action within the first screen, no serious a11y violations. Also captures
 * screenshots of each state for visual review (attached to the HTML report).
 */

async function checkLayout(page: Page, testInfo: TestInfo, name: string, opts: { axe?: boolean } = {}) {
  await settle(page); // page fade-through + component animations
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${name}: horizontal overflow`).toBeLessThanOrEqual(0);

  const small = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")];
    return els
      .filter((el) => !el.closest(".maplibregl-ctrl-attrib, .maplibregl-marker") && el.offsetParent !== null)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
      .map(
        ({ el, r }) =>
          `${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
      );
  });
  expect(small, `${name}: touch targets under 44px`).toEqual([]);

  if (opts.axe !== false) {
    const results = await new AxeBuilder({ page }).exclude(".maplibregl-map").analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `${name}: axe`,
    ).toEqual([]);
  }
  await snap(page, testInfo, name);
}

test("auth pages", async ({ page }, testInfo) => {
  await page.goto("/login?next=%2Fattendance%3Fsource%3Dqr");
  await checkLayout(page, testInfo, "login");
  await page.goto("/login?error=unable_to_get_user_info");
  await checkLayout(page, testInfo, "login-error");
  await page.goto("/login/admin");
  await checkLayout(page, testInfo, "admin-login");
});

test("attendance states", async ({ page, db }, testInfo) => {
  await configureOffice(db);
  const member = await newMember(db, "Jane Doe");
  await installGeoStub(page, inside(15, 9));
  await signInAs(page, db, member);
  await expect(page.getByText("Not clocked in yet")).toBeVisible();

  const cta = page.getByRole("button", { name: "Clock In" });
  await expect(cta).toBeInViewport({ ratio: 1 });
  const box = (await cta.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(60);
  await checkLayout(page, testInfo, "attendance-ready");

  await cta.click();
  await expect(page.getByText(/You're at the office · Verified/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock Out" })).toBeInViewport({
    ratio: 1,
  });
  await checkLayout(page, testInfo, "attendance-clocked-in");

  await page.getByRole("button", { name: "Clock Out" }).click();
  await expect(page.getByText("Attendance complete for today")).toBeVisible();
  await checkLayout(page, testInfo, "attendance-day-complete");

  await configureOffice(db, { configured: false });
  const other = await newMember(db, "Leo Cruz");
  await page.context().clearCookies();
  await signInAs(page, db, other);
  await expect(page.getByText("Attendance isn't set up yet")).toBeVisible();
  await checkLayout(page, testInfo, "attendance-unconfigured");
});

test("admin pages", async ({ page, db }, testInfo) => {
  await configureOffice(db);
  const admin = await adminUser(db);
  await adminSignIn(page, admin.email, ADMIN_TEST_PASSWORD, "/admin/settings");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await mapReady(page);
  const save = page.getByRole("button", { name: "Save settings" });
  await expect(save).toBeInViewport();
  await checkLayout(page, testInfo, "admin-settings");
  await page.goto("/admin/qr");
  await checkLayout(page, testInfo, "admin-qr");
  await page.goto("/admin/attendance");
  await checkLayout(page, testInfo, "admin-attendance-log");
});

test("reduced motion disables animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const duration = await page.evaluate(() => {
    const el = document.querySelector("button")!;
    return getComputedStyle(el).transitionDuration;
  });
  expect(parseFloat(duration)).toBeLessThan(0.02);
});

test("PWA manifest is valid and installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: "Office Mate",
    short_name: "Office Mate",
    display: "standalone",
    start_url: "/attendance",
  });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  const source = await sw.text();
  expect(source).toContain('request.mode !== "navigate"');
  expect(source).not.toMatch(/addEventListener\("sync"|"POST"|cache\.put/);
});

test("buttons show a pointer cursor; disabled ones don't", async ({ page, db }) => {
  const cursor = (name: string | RegExp) =>
    page.getByRole("button", { name }).evaluate((el) => getComputedStyle(el).cursor);
  await page.goto("/login");
  expect(await cursor("Continue with Google")).toBe("pointer");

  await configureOffice(db, { configured: false });
  await signInAs(page, db, await newMember(db));
  expect(await cursor(/Sign out/)).toBe("pointer");
  expect(await cursor("Clock In")).not.toBe("pointer"); // disabled until the office is set up
});

test("route changes fade out then in over 0.6 s", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "view transition pseudo-elements are inspected in Chromium");
  // Record the animations of every view transition the page starts.
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: string[] };
    w.__vt = [];
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((arg: ViewTransitionUpdateCallback) => {
      const transition = start(arg);
      transition.ready.then(() => {
        for (const a of document.getAnimations()) {
          const effect = a.effect as KeyframeEffect | null;
          if (!effect?.pseudoElement) continue;
          const { duration, delay } = effect.getTiming();
          w.__vt.push(`${(a as CSSAnimation).animationName} ${duration}ms +${delay}ms`);
        }
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "Admin sign in" }).click();
  await page.waitForURL(/login\/admin/);
  await settle(page);
  const animations = await page.evaluate(() => (window as unknown as { __vt: string[] }).__vt);
  expect(animations).toEqual(expect.arrayContaining(["fade-out 300ms +0ms", "fade-in 300ms +300ms"]));
  // The browser's default whole-page cross-fade is switched off.
  expect(animations.some((a) => a.startsWith("-ua-view-transition"))).toBe(false);
});

test("the app is branded Office Mate", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle("Sign in · Office Mate");
  await expect(page.getByText("Office Mate", { exact: true })).toBeVisible();
});
