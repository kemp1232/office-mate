import {
  configureOffice,
  DEG_PER_M,
  eventsFor,
  expect,
  geoCalls,
  inside,
  installGeoStub,
  newMember,
  OFFICE,
  setGeo,
  test,
  type GeoMode,
  snap,
  signInAs,
} from "./fixtures";

/** Every attendance failure on a phone: plain-language message, nothing recorded, retry. */

async function ready(page: import("@playwright/test").Page, db: import("pg").Pool, geo: GeoMode) {
  const member = await newMember(db);
  await installGeoStub(page, geo);
  await signInAs(page, db, member);
  await expect(page).toHaveURL(/\/attendance$/);
  return member;
}

test.beforeEach(async ({ db }) => {
  await configureOffice(db);
});

test("location permission denied → explains and allows retry", async ({ page, db }, testInfo) => {
  const member = await ready(page, db, { mode: "error", code: 1 });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Location access is required to clock in")).toBeVisible();
  await snap(page, testInfo, "permission-denied");
  expect(await eventsFor(db, member.id)).toEqual([]);

  // User fixes permissions and retries → succeeds.
  await setGeo(page, inside());
  await page.getByRole("button", { name: /Try Clock (In|Out) again/ }).click();
  await expect(page.getByText(/You're at the office · Verified/)).toBeVisible();
  expect(await eventsFor(db, member.id)).toHaveLength(1);
});

test("location unavailable / timeout → retry prompt", async ({ page, db }) => {
  const member = await ready(page, db, { mode: "error", code: 2 });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
  await setGeo(page, { mode: "error", code: 3 });
  await page.getByRole("button", { name: /Try Clock (In|Out) again/ }).click();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
  expect(await eventsFor(db, member.id)).toEqual([]);
});

test("GPS accuracy worse than 50 m → rejected before the radius check", async ({ page, db }, testInfo) => {
  // Far away AND inaccurate: the accuracy message must win.
  const member = await ready(page, db, {
    mode: "ok",
    latitude: OFFICE.latitude + 5000 * DEG_PER_M,
    longitude: OFFICE.longitude,
    accuracy: 85,
  });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("A more accurate location is needed – try again outdoors")).toBeVisible();
  await expect(page.getByText("85m accuracy · need 50m or better")).toBeVisible();
  await snap(page, testInfo, "poor-accuracy");
  expect(await eventsFor(db, member.id)).toEqual([]);
});

test("outside the 300 m radius → distance and limit shown, nothing recorded", async ({
  page,
  db,
}, testInfo) => {
  const member = await ready(page, db, {
    mode: "ok",
    latitude: OFFICE.latitude + 420 * DEG_PER_M,
    longitude: OFFICE.longitude,
    accuracy: 10,
  });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Outside the office area")).toBeVisible();
  await expect(page.getByText(/420m away · limit 300m/)).toBeVisible();
  await expect(page.getByText(/You need to be within the office area to clock in/)).toBeVisible();
  await snap(page, testInfo, "outside");
  expect(await eventsFor(db, member.id)).toEqual([]);
});

test("Clock Out wording is used when clocking out", async ({ page, db }) => {
  await ready(page, db, inside());
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByRole("button", { name: "Clock Out" })).toBeVisible();
  await setGeo(page, { mode: "error", code: 1 });
  await page.getByRole("button", { name: "Clock Out" }).click();
  await expect(page.getByText("Location access is required to clock out")).toBeVisible();
  await setGeo(page, {
    mode: "ok",
    latitude: OFFICE.latitude + 900 * DEG_PER_M,
    longitude: OFFICE.longitude,
    accuracy: 10,
  });
  await page.getByRole("button", { name: /Try Clock (In|Out) again/ }).click();
  await expect(page.getByText(/You need to be within the office area to clock out/)).toBeVisible();
});

test("offline → 'No connection – try again', no fake success, nothing queued", async ({
  page,
  context,
  db,
}, testInfo) => {
  const member = await ready(page, db, inside());
  await context.setOffline(true);
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("No connection – try again")).toBeVisible();
  await expect(page.getByText(/You're at the office · Verified/)).toHaveCount(0);
  await snap(page, testInfo, "offline");
  expect((await geoCalls(page)).current).toBe(0); // failed fast, didn't even ask for location

  // Coming back online does NOT replay anything by itself.
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  expect(await eventsFor(db, member.id)).toEqual([]);

  await page.getByRole("button", { name: /Try Clock (In|Out) again/ }).click();
  await expect(page.getByText(/You're at the office · Verified/)).toBeVisible();
  expect(await eventsFor(db, member.id)).toHaveLength(1);
});

test("network drops mid-request → error, never a success state", async ({ page, context, db }) => {
  const member = await ready(page, db, { ...inside(), delayMs: 800 });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Checking your location…")).toBeVisible();
  await context.setOffline(true); // after the location request starts, before the server call
  await expect(page.getByText("No connection – try again")).toBeVisible();
  await expect(page.getByText(/You're at the office · Verified/)).toHaveCount(0);
  await context.setOffline(false);
  expect(await eventsFor(db, member.id)).toEqual([]);
});

test("office not configured → attendance disabled for Team Members", async ({ page, db }, testInfo) => {
  await configureOffice(db, { configured: false });
  await ready(page, db, inside());
  await expect(page.getByText("Attendance isn't set up yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock In" })).toBeDisabled();
  await snap(page, testInfo, "unconfigured");
  expect((await geoCalls(page)).current).toBe(0);
});

test("double tap sends one attempt and records one Clock In", async ({ page, db }) => {
  const member = await ready(page, db, { ...inside(), delayMs: 600 });
  const button = page.getByRole("button", { name: "Clock In" });
  await button.dblclick();
  await expect(page.getByText(/You're at the office · Verified/)).toBeVisible();
  expect((await geoCalls(page)).current).toBe(1);
  expect(await eventsFor(db, member.id)).toEqual([{ event_type: "CLOCK_IN", source: "DIRECT" }]);
});

test("response lost after the server recorded Clock In → retry never becomes a Clock Out", async ({
  page,
  db,
}) => {
  const member = await ready(page, db, inside());
  // Let the Server Action reach the server (and commit), then drop the response.
  let dropped = false;
  await page.route("**/attendance*", async (route) => {
    const req = route.request();
    if (!dropped && req.method() === "POST" && req.headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Clock In" }).click();
  // The app re-checks the server before explaining, so it shows the recorded Clock In.
  await expect(page.getByText(/^You're already clocked in at \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock Out" })).toBeVisible();
  expect(await eventsFor(db, member.id)).toEqual([{ event_type: "CLOCK_IN", source: "DIRECT" }]);
});

test("returning to the app re-reads state (e.g. PWA resumed after another device clocked in)", async ({
  page,
  db,
}) => {
  const member = await ready(page, db, inside());
  await expect(page.getByText("Not clocked in yet")).toBeVisible();
  // Clock in behind the page's back, then simulate the app becoming visible again.
  await db.query("select app.record_attendance($1::uuid, $2, $3, 10, 'DIRECT', 'CLOCK_IN', 'Asia/Manila')", [
    member.id,
    OFFICE.latitude,
    OFFICE.longitude,
  ]);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("button", { name: "Clock Out" })).toBeVisible();
  expect((await geoCalls(page)).current).toBe(0);
});

test("a phone whose GPS just woke up still clocks in on one tap", async ({ page, db }) => {
  // First fix is a rough network estimate (180 m), the next is GPS-accurate.
  const member = await ready(page, db, {
    mode: "sequence",
    readings: [
      { ...inside(20, 180), delayMs: 500 },
      { ...inside(20, 14), delayMs: 500 },
    ],
  });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Improving accuracy · 180m")).toBeVisible();
  await expect(page.getByText("You're at the office · Verified · 14m accuracy")).toBeVisible();
  expect(await geoCalls(page)).toEqual({ current: 2, watch: 0 });
  expect(await eventsFor(db, member.id)).toHaveLength(1);
});

test("location permission denied is not retried behind the user's back", async ({ page, db }) => {
  await ready(page, db, { mode: "error", code: 1 });
  await page.getByRole("button", { name: "Clock In" }).click();
  await expect(page.getByText("Location access is required to clock in")).toBeVisible();
  expect((await geoCalls(page)).current).toBe(1);
});
