import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";

/** Regression: a first Google sign-in must create the user AND its Google account together. */
it("Better Auth can create a Google user + account (as the OAuth callback does)", async () => {
  process.env.GOOGLE_CLIENT_ID ||= "x.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET ||= "x";
  const { auth } = await import("@/lib/auth");
  const ctx = await auth().$context;
  const email = `oauth.${randomUUID().slice(0, 8)}@firstmate.tech`;
  let error: unknown;
  try {
    const created = await ctx.internalAdapter.createOAuthUser(
      { email, name: "OAuth Test", emailVerified: true, image: "https://lh3.googleusercontent.com/a/x" },
      {
        providerId: "google",
        accountId: `sub-${randomUUID()}`,
        accessToken: "ya29.fake-access-token",
        refreshToken: undefined,
        idToken: "eyJ.fake.idtoken",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "openid,email,profile",
      },
    );
    expect(created.account.providerId).toBe("google");
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
});
