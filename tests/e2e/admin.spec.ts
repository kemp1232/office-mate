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
  E2E_ORIGIN,
  newMember,
} from "./fixtures";
import { createUser } from "../support/db";

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
  await expect(page.getByText(`${E2E_ORIGIN}/attendance?source=qr`)).toBeVisible();
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

test("Google Sheet sync status is shown to the Admin", async ({ page }) => {
  const card = page.getByRole("region", { name: "Google Sheet sync" });
  await expect(card).toBeVisible();
  // The E2E server has no service account, so sync is reported as not set up (never silently failing).
  await expect(card.getByText("Not set up yet")).toBeVisible();
  await expect(card.getByText(/GOOGLE_SERVICE_ACCOUNT_EMAIL/)).toBeVisible();
});

test.describe("attendance log", () => {
  test("defaults to the latest office day and switches days from the select", async ({ page, db }) => {
    const tag = Math.random().toString(36).slice(2, 7);
    const member = await newMember(db, `Log Tester ${tag}`);
    const noName = await createUser(db, { name: "" });
    // Today (Manila) is always the newest office day; yesterday is the previous one.
    const { rows } = await db.query<{ today: string; yesterday: string }>(
      `select (now() at time zone 'Asia/Manila')::date::text as today,
              ((now() at time zone 'Asia/Manila')::date - 1)::text as yesterday`,
    );
    const { today, yesterday } = rows[0];
    const insert = (u: { id: string; email: string }, day: string, type: string, manila: string) =>
      db.query(
        `insert into app.attendance_events (user_id, email, event_type, attendance_day, recorded_at, latitude, longitude,
           accuracy_m, distance_m, office_latitude, office_longitude, radius_m, accuracy_threshold_m)
         values ($1, $2, $3, $4::date, ($4 || ' ' || $5)::timestamp at time zone 'Asia/Manila',
                 14.5547, 121.0244, 5, 0, 14.5547, 121.0244, 300, 50)`,
        [u.id, u.email, type, day, manila],
      );
    await insert(member, today, "CLOCK_IN", "00:04");
    await insert(member, today, "CLOCK_OUT", "00:32");
    await insert(noName, today, "CLOCK_IN", "00:10");
    await insert(member, yesterday, "CLOCK_IN", "08:45");

    await page.goto("/admin/attendance");
    const select = page.getByLabel("Office day");
    await expect(select).toHaveValue(today);
    const row = page.getByRole("row", { name: new RegExp(`Log Tester ${tag}`) });
    await expect(row).toContainText("00:04");
    await expect(row).toContainText("00:32");
    // No name → the email is shown instead.
    const emailRow = page.getByRole("row", { name: new RegExp(noName.email) });
    await expect(emailRow).toContainText("00:10");
    await expect(emailRow).toContainText("Not yet");

    await select.selectOption(yesterday);
    await expect(page).toHaveURL(new RegExp(`day=${yesterday}`));
    await expect(page.getByRole("row", { name: new RegExp(`Log Tester ${tag}`) })).toContainText("08:45");
  });

  test("the Admin has no Clock In screen", async ({ page }) => {
    await page.goto("/attendance");
    await expect(page).toHaveURL(/\/admin\/attendance/);
    await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin\/attendance/);
  });
});
