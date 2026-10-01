import type pg from "pg";
import {
  adminSignIn,
  adminUser,
  ADMIN_TEST_PASSWORD,
  configureOffice,
  E2E_ORIGIN,
  eventsFor,
  expect,
  geoCalls,
  inside,
  installGeoStub,
  newMember,
  settle,
  signInAs,
  snap,
  test,
} from "./fixtures";
import { createUser, sessionCookieFor, uniqueEmail } from "../support/db";

/** Admin team management, and how a member's Clock Out rule / today's lock looks on their phone. */

const tag = () => Math.random().toString(36).slice(2, 7);

async function today(db: pg.Pool) {
  const { rows } = await db.query<{ d: string }>(
    "select (now() at time zone 'Asia/Manila')::date::text as d",
  );
  return rows[0].d;
}

async function overrideFor(db: pg.Pool, userId: string) {
  const { rows } = await db.query<{ state: string }>(
    "select state::text from app.clock_out_overrides where user_id = $1 and attendance_day = $2::date",
    [userId, await today(db)],
  );
  return rows[0]?.state ?? null;
}

test.describe("Admin team page", () => {
  test.beforeEach(async ({ page, db }) => {
    await configureOffice(db);
    const admin = await adminUser(db);
    await adminSignIn(page, admin.email, ADMIN_TEST_PASSWORD, "/admin/team");
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  });

  test("the prefilled team is listed and searchable", async ({ page }, testInfo) => {
    await page.getByLabel("Search the team").fill("zozobrado");
    const row = page.getByRole("row", { name: /Jake Zozobrado/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText("jakezozobrado@firstmate.tech");
    await expect(row).toContainText("No Clock Out rule");
    await expect(page.getByText(/^1 person match/)).toBeVisible();
    await settle(page);
    await snap(page, testInfo, "team-search");
    await page.getByLabel("Search the team").fill("no such person");
    await expect(page.getByText("Nobody matches that search")).toBeVisible();
  });

  test("add a member with required hours, then change them to a fixed time", async ({
    page,
    db,
  }, testInfo) => {
    const t = tag();
    const email = uniqueEmail(`added${t}`);
    await page.getByRole("link", { name: "Add member" }).click();
    await expect(page.getByRole("heading", { name: "Add team member" })).toBeVisible();

    // Validation: org email only, and hours within range.
    await page.getByLabel("First name").fill(`Added ${t}`);
    await page.getByLabel("Last name").fill("Person");
    await page.getByLabel("Email").fill("someone@gmail.com");
    await page.getByLabel("Required hours", { exact: false }).first().check();
    await page.getByRole("spinbutton", { name: "Required hours" }).fill("20");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Use their @firstmate.tech email")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();

    await page.getByLabel("Email").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Between 0.5 and 16 hours")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Required hours" }).fill("8.5");
    await settle(page);
    await snap(page, testInfo, "team-add-member");
    await page.getByRole("button", { name: "Add member" }).click();

    await expect(page).toHaveURL(/\/admin\/team\?saved=/);
    await expect(page.getByText(`Saved Added ${t} Person`)).toBeVisible();
    await page.getByLabel("Search the team").fill(t);
    const row = page.getByRole("row", { name: new RegExp(`Added ${t} Person`) });
    await expect(row).toContainText(email);
    await expect(row).toContainText("8h 30m after Clock In");
    await expect(row).toContainText("Not signed in yet");

    // The same email can't be added twice.
    await page.goto("/admin/team/new");
    await page.getByLabel("First name").fill("Dup");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Someone on the team already uses this email")).toBeVisible();

    // Edit: names + a fixed Clock Out time. Before their first sign in the email can still change.
    await page.goto("/admin/team");
    await page.getByLabel("Search the team").fill(t);
    await page.getByRole("link", { name: `Edit Added ${t} Person` }).click();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Email")).not.toHaveAttribute("readonly");
    await page.getByLabel("Last name").fill("Renamed");
    await page.getByLabel("Fixed Clock Out time").check();
    await page.getByLabel("Clock Out from", { exact: true }).fill("18:00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`Saved Added ${t} Renamed`)).toBeVisible();
    await page.getByLabel("Search the team").fill(t);
    await expect(page.getByRole("row", { name: new RegExp(`Added ${t} Renamed`) })).toContainText(
      "Clock Out from 18:00",
    );
    const { rows } = await db.query<{ mode: string; t: string }>(
      `select r.mode::text, to_char(r.clock_out_time, 'HH24:MI') as t
       from app.clock_out_rules r join app.users u on u.id = r.user_id where u.email = $1`,
      [email],
    );
    expect(rows[0]).toEqual({ mode: "TIME", t: "18:00" });
  });

  test("a member's email is fixed once they've signed in with Google", async ({ page, db }) => {
    const member = await createUser(db, { name: `Signed In ${tag()}` }); // has a Google account
    await page.goto(`/admin/team/${member.id}`);
    await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
    await expect(
      page.getByText(/signed in with this Google account, so the email can't change/),
    ).toBeVisible();
  });

  test("lock and unlock Clock Out for today", async ({ page, db }, testInfo) => {
    const t = tag();
    const member = await newMember(db, `Lockable ${t}`);
    await page.reload(); // the list was loaded before this member existed
    await page.getByLabel("Search the team").fill(t);
    const row = page.getByRole("row", { name: new RegExp(`Lockable ${t}`) });
    const control = row.getByRole("group", { name: /Clock Out today/ });
    await expect(control.getByRole("radio", { name: "Follow rule" })).toBeChecked();

    await control.getByRole("radio", { name: "Lock", exact: true }).click();
    await expect.poll(() => overrideFor(db, member.id)).toBe("LOCKED");
    await expect(row).toContainText("Clock Out locked today");
    await settle(page);
    await snap(page, testInfo, "team-locked");

    await control.getByRole("radio", { name: "Unlock", exact: true }).click();
    await expect.poll(() => overrideFor(db, member.id)).toBe("UNLOCKED");
    await expect(row).toContainText("Clock Out unlocked today");

    await control.getByRole("radio", { name: "Follow rule", exact: true }).click();
    await expect.poll(() => overrideFor(db, member.id)).toBeNull();
  });

  test("deactivate signs the member out and blocks them; reactivate restores access", async ({
    page,
    db,
    browser,
  }) => {
    const t = tag();
    const member = await newMember(db, `Leaving ${t}`);
    const phone = await browser.newContext();
    const memberPage = await phone.newPage();
    await memberPage.context().addCookies([{ ...(await sessionCookieFor(db, member.id)), url: E2E_ORIGIN }]);
    await memberPage.goto("/attendance");
    await expect(memberPage.getByRole("heading", { name: /^Hi, Leaving/ })).toBeVisible();

    await page.goto(`/admin/team/${member.id}`);
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText(`Deactivate Leaving ${t}?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, deactivate" }).click();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

    await memberPage.reload();
    await expect(memberPage).toHaveURL(/\/login/);

    // Hidden from the list unless asked for.
    await page.goto("/admin/team");
    await page.getByLabel("Search the team").fill(t);
    await expect(page.getByText("Nobody matches that search")).toBeVisible();
    await page.getByLabel(/Show deactivated/).check();
    await expect(page.getByRole("row", { name: new RegExp(`Leaving ${t}`) })).toContainText("Deactivated");

    await page.goto(`/admin/team/${member.id}`);
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
    const { rows } = await db.query("select deactivated_at from app.users where id = $1", [member.id]);
    expect(rows[0].deactivated_at).toBeNull();
    await phone.close();
  });

  test("Team Members can't open the team page", async ({ page, db }) => {
    const member = await newMember(db);
    await page.context().clearCookies();
    await signInAs(page, db, member, "/admin/team");
    await expect(page).toHaveURL(/\/attendance$/);
  });
});

test.describe("member Clock Out rules on the phone", () => {
  test.beforeEach(async ({ db }) => {
    await configureOffice(db);
  });

  test("Clock Out waits for the required hours, until the Admin unlocks it", async ({
    page,
    db,
  }, testInfo) => {
    const member = await newMember(db, `Hours ${tag()}`);
    await db.query(
      "insert into app.clock_out_rules (user_id, mode, required_minutes) values ($1, 'HOURS', 540)",
      [member.id],
    );
    await installGeoStub(page, inside());
    await signInAs(page, db, member);
    await page.getByRole("button", { name: "Clock In" }).click();
    await expect(page.getByText(/^Clocked in at/)).toBeVisible();

    // Back to idle: the button shows when Clock Out opens and does nothing yet.
    await page.reload();
    const gated = page.getByRole("button", { name: /^Clock Out at \d{2}:\d{2}$/ });
    await expect(gated).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/^You can clock out at \d{2}:\d{2}$/)).toBeVisible();
    await expect(page.getByText("That's 9h after you clocked in.")).toBeVisible();
    await settle(page);
    await snap(page, testInfo, "clock-out-not-yet");
    await gated.click({ force: true });
    expect((await geoCalls(page)).current).toBe(0); // location isn't requested for a closed Clock Out

    // The Admin unlocks it for today; the member's screen picks that up when they come back to it.
    await db.query(
      `insert into app.clock_out_overrides (user_id, attendance_day, state) values ($1, $2::date, 'UNLOCKED')`,
      [member.id, await today(db)],
    );
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    const clockOut = page.getByRole("button", { name: "Clock Out", exact: true });
    await expect(clockOut).toBeVisible();
    await clockOut.click();
    await expect(page.getByText(/^Clocked out at/)).toBeVisible();
    expect((await eventsFor(db, member.id)).map((e) => e.event_type)).toEqual(["CLOCK_IN", "CLOCK_OUT"]);
  });

  test("a locked Clock Out explains itself", async ({ page, db }, testInfo) => {
    const member = await newMember(db, `Locked ${tag()}`);
    await installGeoStub(page, inside());
    await signInAs(page, db, member);
    await page.getByRole("button", { name: "Clock In" }).click();
    await expect(page.getByText(/^Clocked in at/)).toBeVisible();
    await db.query(
      `insert into app.clock_out_overrides (user_id, attendance_day, state) values ($1, $2::date, 'LOCKED')`,
      [member.id, await today(db)],
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Clock Out locked" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByText("Clock Out is locked for today")).toBeVisible();
    await settle(page);
    await snap(page, testInfo, "clock-out-locked");
  });
});
