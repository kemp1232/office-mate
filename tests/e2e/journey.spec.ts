import {
  configureOffice,
  eventsFor,
  expect,
  geoCalls,
  inside,
  installGeoStub,
  newMember,
  test,
  snap,
  signInAs,
  startGoogleSignIn,
} from "./fixtures";

/**
 * The primary product flow on a phone:
 * QR URL → login → back to Attendance → Clock In → Checking location → verified → Clocked In
 * → Clock Out → Day complete.
 */
test("QR → sign in → Clock In → Clock Out → Day complete", async ({ page, db }, testInfo) => {
  await configureOffice(db);
  const member = await newMember(db, "Jane Doe");
  await installGeoStub(page, { ...inside(25, 12), delayMs: 700 });

  // Scanning the QR opens the app; signed-out users are sent to login with the destination kept.
  await page.goto("/attendance?source=qr");
  await expect(page).toHaveURL(/\/login\?next=%2Fattendance%3Fsource%3Dqr$/);
  await expect(page.getByRole("heading", { name: "Clock in at the office" })).toBeVisible();

  // Google Workspace sign-in carries the QR destination through OAuth…
  await startGoogleSignIn(page, "/attendance?source=qr");
  // …and Google returns to it (test equivalent: the session Better Auth creates after the callback).
  await signInAs(page, db, member, "/attendance?source=qr");

  // Straight back to Attendance, QR source preserved, nothing recorded yet.
  await expect(page).toHaveURL(/\/attendance\?source=qr$/);
  await expect(page.getByRole("heading", { name: "Hi, Jane" })).toBeVisible();
  await expect(page.getByText("Not clocked in yet")).toBeVisible();
  expect(await eventsFor(db, member.id)).toEqual([]);
  expect((await geoCalls(page)).current).toBe(0); // no location request on page load

  const clockIn = page.getByRole("button", { name: "Clock In" });
  await expect(clockIn).toBeInViewport();
  await clockIn.click();
  await expect(page.getByRole("status").getByText("Checking your location…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Checking location…" })).toBeDisabled();

  await expect(page.getByText(/You're at the office · Verified/)).toBeVisible();
  await expect(page.getByText("You're at the office · Verified · 12m accuracy")).toBeVisible();
  await expect(page.getByText(/^Clocked in at \d\d:\d\d$/)).toBeVisible();
  const card = page.getByRole("region", { name: "Today's attendance" });
  await expect(card.getByText("Clocked in")).toBeVisible();
  await expect(card.getByText(/Elapsed \d+m/)).toBeVisible();
  await snap(page, testInfo, "clocked-in");

  // Clock In is no longer offered; Clock Out is.
  await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clock Out" }).click();
  await expect(page.getByText("Attendance complete for today")).toBeVisible();
  await expect(page.getByRole("button", { name: /Clock (In|Out)/ })).toHaveCount(0);
  await snap(page, testInfo, "day-complete");

  // Exactly one location request per tap, never watched.
  expect(await geoCalls(page)).toEqual({ current: 2, watch: 0 });
  expect(await eventsFor(db, member.id)).toEqual([
    { event_type: "CLOCK_IN", source: "QR" },
    { event_type: "CLOCK_OUT", source: "QR" },
  ]);

  // State is server-derived: a reload still shows the completed day.
  await page.reload();
  await expect(page.getByText("Attendance complete for today")).toBeVisible();
});
