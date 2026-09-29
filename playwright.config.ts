import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT, loadTestEnv } from "./tests/support/env";

loadTestEnv();

// An editor installed as a Snap (e.g. VS Code) leaks GTK/GIO module paths into child processes,
// which crashes WebKit's network process (glibc symbol mismatch). Browsers don't need them.
if (process.env.SNAP) {
  for (const key of [
    "GIO_MODULE_DIR",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "LOCPATH",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GTK_IM_MODULE_FILE",
  ]) {
    delete process.env[key];
  }
}

const PORT = E2E_PORT;
const baseURL = E2E_ORIGIN;

/**
 * E2E runs against a production build (`next build && next start`) and local Supabase.
 * Workers = 1 because the org has ONE settings row that several specs change.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Small phone (320×568) — the strictest layout target; runs every spec.
    { name: "iphone-se", use: { ...devices["iPhone SE"], browserName: "chromium" } },
    // Typical + large phones.
    { name: "pixel-7", use: { ...devices["Pixel 7"] }, testMatch: /(journey|failures|layout)\.spec\.ts/ },
    {
      name: "iphone-15-pro-max",
      use: { ...devices["iPhone 15 Pro Max"], browserName: "chromium" },
      testMatch: /(journey|layout)\.spec\.ts/,
    },
    { name: "phone-landscape", use: { ...devices["Pixel 7 landscape"] }, testMatch: /layout\.spec\.ts/ },
    // Real WebKit engine (Safari) for the core phone journey.
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] }, testMatch: /journey\.spec\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /(journey|auth|admin|layout)\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Real env vars win over the .env.local that `next` also reads, so the server uses local Supabase.
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
      BETTER_AUTH_URL: baseURL,
      ATTENDANCE_TIMEZONE: process.env.ATTENDANCE_TIMEZONE!,
      // Placeholder Google client so the sign-in redirect can be asserted (Google itself is stubbed).
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      // Never let test clock-ins reach a real Google Sheet (next also reads .env.local).
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "",
      GOOGLE_SERVICE_ACCOUNT_KEY: "",
    },
  },
});
