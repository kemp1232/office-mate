import {
  adminUser,
  configureOffice,
  expect,
  test,
  snap,
  mapReady,
  settle,
  adminSignIn,
  ADMIN_TEST_PASSWORD,
} from "./fixtures";

test.beforeEach(async ({ page, db }) => {
  await configureOffice(db, { configured: false });
  const admin = await adminUser(db);
  await adminSignIn(page, admin.email, ADMIN_TEST_PASSWORD, "/admin/settings");
  await expect(page.getByRole("heading", { name: "Attendance settings" })).toBeVisible();
});

test("first run: setup incomplete → drop pin on map → save", async ({ page, db }, testInfo) => {
  await expect(page.getByText("Attendance setup incomplete")).toBeVisible();
  await expect(page.getByText("No office location set")).toBeVisible();

  const map = page.locator(".maplibregl-canvas");
  await map.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(map).toBeVisible();
  await mapReady(page);
  await snap(page, testInfo, "settings-unconfigured");

  const box = (await map.boundingBox())!;
  if (testInfo.project.use.hasTouch)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByLabel("Office location pin")).toBeVisible();
  await expect(page.getByText(/^1[0-9]\.\d{6}, 12[0-9]\.\d{6}$/)).toBeVisible();

  await page.getByLabel("Geofence radius").fill("250");
  await page.getByLabel("GPS accuracy threshold").fill("300");
  const save = page.getByRole("button", { name: "Save settings" });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await settle(page);
  await snap(page, testInfo, "settings-saved", true);

  const { rows } = await db.query(
    "select office_latitude, radius_m, accuracy_threshold_m from app.attendance_settings",
  );
  expect(rows[0].office_latitude).not.toBeNull();
  expect(rows[0].radius_m).toBe(250);
  expect(rows[0].accuracy_threshold_m).toBe(300);

  await page.reload();
  await expect(page.getByLabel("Geofence radius")).toHaveValue("250");
  await expect(page.getByText("Attendance setup incomplete")).toHaveCount(0);
});

test("drag the pin to move the office", async ({ page, db }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.hasTouch), "mouse drag; touch placement covered above");
  await configureOffice(db);
  await page.reload();
  const pin = page.getByLabel("Office location pin");
  await pin.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(pin).toBeVisible();
  const before = await page.getByText(/^1[0-9]\.\d{6}, 12[0-9]\.\d{6}$/).textContent();
  const box = (await pin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/^1[0-9]\.\d{6}, 12[0-9]\.\d{6}$/)).not.toHaveText(before!);
  await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();
});

test("validation errors appear next to the field", async ({ page, db }) => {
  await configureOffice(db);
  await page.reload();
  await page.getByLabel("Geofence radius").fill("5");
  await page.getByLabel("Google Sheet URL").fill("not a url");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("At least 10 m")).toBeVisible();
  await expect(page.getByText("Enter a valid URL")).toBeVisible();
  await expect(page.getByLabel("Geofence radius")).toHaveAttribute("aria-invalid", "true");
  const { rows } = await db.query("select radius_m from app.attendance_settings");
  expect(rows[0].radius_m).toBe(300);
});

test("report link opens the configured Google Sheet", async ({ page }) => {
  const link = page.getByRole("link", { name: "Open report" });
  await expect(link).toHaveAttribute("href", /^https:\/\/docs\.google\.com\/spreadsheets\//);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("QR page shows one static code for the Attendance URL and prints cleanly", async ({
  page,
}, testInfo) => {
  await page.getByRole("link", { name: "Attendance QR code" }).click();
  await expect(page.getByRole("heading", { name: "Office QR code" })).toBeVisible();
  await expect(page.getByText("http://localhost:3000/attendance?source=qr")).toBeVisible();
  await expect(
    page.locator("svg").filter({
      has: page.locator("title", { hasText: "Attendance QR code" }),
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Print QR code" })).toBeVisible();
  await snap(page, testInfo, "qr", true);

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print QR code" })).toBeHidden();
  await expect(page.locator("header")).toBeHidden();
  await snap(page, testInfo, "qr-print", true);
});
