import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import type pg from "pg";
import { E2E_ORIGIN } from "../support/env";
import {
  ADMIN_TEST_PASSWORD,
  adminPool,
  adminUser,
  createUser,
  DEG_PER_M,
  OFFICE,
  officeOffset,
  sessionCookieFor,
  setSettings,
} from "../support/db";

export { expect, E2E_ORIGIN };
export { ADMIN_TEST_PASSWORD, adminUser, DEG_PER_M, OFFICE, officeOffset };

export type GeoReading =
  | { mode: "ok"; latitude: number; longitude: number; accuracy: number; delayMs?: number }
  | { mode: "error"; code: 1 | 2 | 3; delayMs?: number };

export type GeoMode =
  | GeoReading
  /** Successive readings for successive calls (the last one repeats), e.g. a GPS warming up. */
  | { mode: "sequence"; readings: GeoReading[] }
  /** The browser never calls back at all (iPhone with Location off for the browser app). */
  | { mode: "silent" };

type Fixtures = { db: pg.Pool; freshRateLimits: void };

/**
 * - `freshRateLimits` (automatic): tests run one at a time, so clearing Better Auth's rate-limit
 *   table before each test keeps production limits on without tests throttling each other.
 * - A deterministic geolocation stub: tests choose the outcome per tap and can assert that
 *   location is requested only once per tap and never watched.
 */
export const test = base.extend<Fixtures>({
  db: async ({}, use) => {
    const pool = adminPool();
    await use(pool);
    await pool.end();
  },
  freshRateLimits: [
    async ({ db }, use) => {
      await db.query("delete from app.rate_limits");
      await use();
    },
    { auto: true },
  ],
});

/** Waits for the page fade-through and any component animations to finish. */
export async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

/** Waits until the Admin map has loaded its style (see office-map.tsx `data-map-ready`). */
export async function mapReady(page: Page) {
  await expect(page.locator("[data-map-ready]")).toBeAttached();
}

/** Installs the geolocation stub before any page script runs. */
export async function installGeoStub(page: Page, initial: GeoMode) {
  await page.addInitScript((geo: GeoMode) => {
    const w = window as unknown as {
      __geo: GeoMode;
      __geoCalls: number;
      __watchCalls: number;
    };
    w.__geo = geo;
    w.__geoCalls = 0;
    w.__watchCalls = 0;
    const stub = {
      getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null) {
        w.__geoCalls += 1;
        const current = w.__geo;
        if (current.mode === "silent") return;
        const g =
          current.mode === "sequence"
            ? current.readings[Math.min(w.__geoCalls - 1, current.readings.length - 1)]
            : current;
        setTimeout(() => {
          if (g.mode === "ok") {
            ok({
              coords: {
                latitude: g.latitude,
                longitude: g.longitude,
                accuracy: g.accuracy,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          } else {
            fail?.({
              code: g.code,
              message: "stub",
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            } as GeolocationPositionError);
          }
        }, g.delayMs ?? 400);
      },
      watchPosition() {
        w.__watchCalls += 1;
        return 0;
      },
      clearWatch() {},
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      get: () => stub,
    });
  }, initial);
}

export async function setGeo(page: Page, geo: GeoMode) {
  await page.evaluate((g) => {
    (window as unknown as { __geo: GeoMode }).__geo = g;
  }, geo);
}

export async function geoCalls(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __geoCalls: number; __watchCalls: number };
    return { current: w.__geoCalls, watch: w.__watchCalls };
  });
}

export const inside = (metres = 20, accuracy = 12): GeoReading => ({
  mode: "ok",
  latitude: officeOffset(metres),
  longitude: OFFICE.longitude,
  accuracy,
});

export async function newMember(db: pg.Pool, name = "Jane Doe") {
  return createUser(db, { name });
}

/** Signs a Team Member in (as if Google SSO had just completed) and opens `path`. */
export async function signInAs(page: Page, db: pg.Pool, user: { id: string }, path = "/attendance") {
  const cookie = await sessionCookieFor(db, user.id);
  await page.context().addCookies([{ ...cookie, url: E2E_ORIGIN }]);
  await page.goto(path);
}

/**
 * Clicks "Continue with Google" and checks the app sends the browser to Google correctly: the
 * Workspace `hd` hint, our callback URI, PKCE + state, and the post-login destination `next`.
 * Returns once the Google redirect is intercepted (real Google can't run in tests).
 */
export async function startGoogleSignIn(page: Page, next: string) {
  let authorize: URL | undefined;
  await page.route("https://accounts.google.com/**", async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google (stub)</p>" });
  });
  const socialRequest = page.waitForRequest((r) => r.url().endsWith("/api/auth/sign-in/social"));
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const body = (await socialRequest).postDataJSON() as { provider: string; callbackURL: string };
  expect(body).toMatchObject({ provider: "google", callbackURL: next });
  await expect.poll(() => authorize?.hostname).toBe("accounts.google.com");
  const params = authorize!.searchParams;
  expect(params.get("hd")).toBe("firstmate.tech");
  expect(params.get("redirect_uri")).toBe(`${E2E_ORIGIN}/api/auth/callback/google`);
  expect(params.get("response_type")).toBe("code");
  expect(params.get("prompt")).toBe("select_account");
  expect(params.get("scope")).toContain("email");
  expect(params.get("state")).toBeTruthy();
  expect(params.get("code_challenge_method")).toBe("S256");
  await page.unroute("https://accounts.google.com/**");
}

/** The real Admin email + password form. */
export async function adminSignIn(page: Page, email: string, password: string, nextPath?: string) {
  await page.goto(nextPath ? `/login/admin?next=${encodeURIComponent(nextPath)}` : "/login/admin");
  await page.getByLabel("Admin email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function configureOffice(db: pg.Pool, opts?: Parameters<typeof setSettings>[1]) {
  await setSettings(db, opts);
}

export async function eventsFor(db: pg.Pool, userId: string) {
  const { rows } = await db.query<{ event_type: string; source: string }>(
    "select event_type::text, source::text from app.attendance_events where user_id = $1 order by recorded_at",
    [userId],
  );
  return rows;
}

/** Attaches a screenshot to the report and keeps a named copy in test-results/ for visual review. */
export async function snap(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const body = await page.screenshot({
    fullPage,
    path: testInfo.outputPath(`${name}.png`),
  });
  await testInfo.attach(name, { body, contentType: "image/png" });
}
