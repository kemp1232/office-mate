import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { adminPool, createUser, uniqueEmail } from "../support/db";

/**
 * The Google callback's user handling (Better Auth's handleOAuthUserInfo, with this app's
 * config and hooks) against the real database: what happens when a Workspace user signs in
 * and the Admin has (or hasn't) already added them to the team.
 */
let admin: pg.Pool;
type Ctx = Awaited<ReturnType<typeof import("@/lib/auth").auth>["$context"]>;
let ctx: Ctx;
let handleOAuthUserInfo: typeof import("better-auth/oauth2").handleOAuthUserInfo;
let runWithEndpointContext: typeof import("@better-auth/core/context").runWithEndpointContext;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID ||= "x.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET ||= "x";
  const { auth } = await import("@/lib/auth");
  ctx = await auth().$context;
  ({ handleOAuthUserInfo } = await import("better-auth/oauth2"));
  ({ runWithEndpointContext } = await import("@better-auth/core/context"));
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

/** What the callback passes after Google verified the ID token (hd + email_verified). */
function googleSignIn(
  email: string,
  profile: { given: string; family: string },
  sub = `sub-${randomUUID()}`,
) {
  // The callback endpoint's context (hooks such as validateUserInfo read it).
  const endpoint = { context: ctx } as never;
  // The callback spreads mapProfileToUser's output (given_name / family_name) into userInfo.
  const userInfo = {
    id: sub,
    email,
    emailVerified: true,
    name: `${profile.given} ${profile.family}`,
    image: undefined,
    firstName: profile.given,
    lastName: profile.family,
  };
  return runWithEndpointContext(endpoint, () =>
    handleOAuthUserInfo(endpoint, {
      userInfo,
      account: {
        providerId: "google",
        accountId: sub,
        accessToken: "ya29.fake-access-token",
        idToken: "eyJ.fake.idtoken",
        scope: "openid,email,profile",
      },
      callbackURL: "/attendance",
      disableSignUp: false,
      overrideUserInfo: false,
      source: { method: "oauth", oauth: { providerId: "google" } },
    }),
  );
}

async function addMember(email: string, first: string, last: string) {
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.users (name, first_name, last_name, email, email_verified, updated_at)
     values ('', $1, $2, $3, true, now()) returning id`,
    [first, last, email],
  );
  return rows[0].id;
}

const userRow = async (email: string) =>
  (
    await admin.query<{ id: string; first_name: string; last_name: string; email_verified: boolean }>(
      "select id, first_name, last_name, email_verified from app.users where email = $1",
      [email],
    )
  ).rows[0];

const googleAccounts = async (userId: string) =>
  Number(
    (
      await admin.query("select count(*) from app.accounts where user_id = $1 and provider_id = 'google'", [
        userId,
      ])
    ).rows[0].count,
  );

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    const result = (await promise) as { error?: string | null };
    return result.error ?? undefined;
  } catch (e) {
    return (e as { body?: { code?: string } }).body?.code ?? String(e);
  }
}

describe("Google sign in and the team list", () => {
  it("links a member the Admin added to their Google account, keeping the Admin's names", async () => {
    const email = uniqueEmail("preadded");
    const id = await addMember(email, "Jessa Mae", "Abella");
    const sub = `sub-${randomUUID()}`;

    const first = await googleSignIn(email, { given: "Jessa", family: "A." }, sub);
    expect(first.error).toBeNull();
    expect(first.data?.user.id).toBe(id);
    expect(first.data?.session.userId).toBe(id);
    expect(await googleAccounts(id)).toBe(1);
    expect(await userRow(email)).toMatchObject({ first_name: "Jessa Mae", last_name: "Abella" });

    // A later sign in reuses the same account and still doesn't overwrite the names.
    const again = await googleSignIn(email, { given: "Someone", family: "Else" }, sub);
    expect(again.data?.user.id).toBe(id);
    expect(await googleAccounts(id)).toBe(1);
    expect(await userRow(email)).toMatchObject({ first_name: "Jessa Mae", last_name: "Abella" });
  });

  it("adds someone who isn't on the list, with their Google first and last name", async () => {
    const email = uniqueEmail("newcomer");
    const result = await googleSignIn(email, { given: "Carlos Miguel", family: "Canonizado" });
    expect(result.error).toBeNull();
    expect(result.isRegister).toBe(true);
    expect(await userRow(email)).toMatchObject({
      first_name: "Carlos Miguel",
      last_name: "Canonizado",
      email_verified: true,
    });
  });

  it("refuses a deactivated member before linking or creating a session", async () => {
    const email = uniqueEmail("deactivated");
    const id = await addMember(email, "Former", "Member");
    await admin.query("update app.users set deactivated_at = now() where id = $1", [id]);
    expect(await errorCode(googleSignIn(email, { given: "Former", family: "Member" }))).toBe(
      "ACCOUNT_DEACTIVATED",
    );
    expect(await googleAccounts(id)).toBe(0);
  });

  it("refuses a deactivated member who had signed in before", async () => {
    const member = await createUser(admin, { email: uniqueEmail("leaver") }); // has a Google account
    const sub = (
      await admin.query<{ account_id: string }>("select account_id from app.accounts where user_id = $1", [
        member.id,
      ])
    ).rows[0].account_id;
    await admin.query("update app.users set deactivated_at = now() where id = $1", [member.id]);
    expect(await errorCode(googleSignIn(member.email, { given: "L", family: "M" }, sub))).toBe(
      "ACCOUNT_DEACTIVATED",
    );
    // …and no other path can create a session for them either.
    await expect(ctx.internalAdapter.createSession(member.id)).rejects.toMatchObject({
      body: { code: "ACCOUNT_DEACTIVATED" },
    });
  });

  it("never links Google to the Admin account", async () => {
    const adminUser = await createUser(admin, {
      email: "admin@firstmate.tech",
      password: "admin-e2e-password-123",
    });
    const before = await googleAccounts(adminUser.id); // other suites' fixtures may add one
    expect(await errorCode(googleSignIn("admin@firstmate.tech", { given: "Not", family: "Admin" }))).toBe(
      "ADMIN_USES_PASSWORD",
    );
    expect(await googleAccounts(adminUser.id)).toBe(before);
  });
});
