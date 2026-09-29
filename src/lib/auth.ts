import "server-only";
import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { PostgresDialect } from "kysely";
import { isAdminEmail, isOrgEmail, ORG_DOMAIN } from "@/features/auth/roles";
import { db } from "./db";
import { env } from "./env";

/**
 * Better Auth.
 * - Team Members: Google Workspace SSO only. `hd` makes Google verify the ID token's hosted-domain
 *   claim is firstmate.tech (server-side), and a DB hook + DB constraint re-check the email domain.
 *   A valid account becomes a Team Member on first sign-in. No member passwords exist.
 * - Admin: email + password only, for admin@firstmate.tech (created by `npm run admin:create`).
 *   Password sign-in is refused for every other address; public email sign-up is disabled.
 * - Implicit account linking is off, so Google can never attach to the Admin account.
 * - Role is never stored or accepted from the client; it is derived from the verified email
 *   (see features/auth/roles.ts and app.is_admin()).
 */

const domainError = () =>
  new APIError("FORBIDDEN", {
    code: "EMAIL_DOMAIN_NOT_ALLOWED",
    message: `Use your @${ORG_DOMAIN} Google Workspace account.`,
  });

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Office Mate",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: {
      dialect: new PostgresDialect({ pool: db() }),
      type: "postgres",
      schemaName: "app",
      transaction: true,
    },
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
    },
    session: {
      modelName: "sessions",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
      expiresIn: 60 * 60 * 24 * 30, // 30 days: phone users shouldn't re-login every scan
      updateAge: 60 * 60 * 24,
    },
    socialProviders:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: e.GOOGLE_CLIENT_ID,
              clientSecret: e.GOOGLE_CLIENT_SECRET,
              hd: ORG_DOMAIN, // account-picker hint AND verified id-token `hd` claim check
              prompt: "select_account",
            },
          }
        : {},
    account: {
      // Each person has exactly one sign-in method; never merge Google into the password account.
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
      modelName: "accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
      storeIdentifier: "hashed",
    },
    rateLimit: {
      storage: "database",
      modelName: "rate_limits",
      fields: { lastRequest: "last_request" },
      // Per client IP (x-real-ip is set by Vercel; behind another proxy, point ipAddressHeaders at
      // a header that proxy overwrites). The whole office shares one Wi-Fi IP, so limits leave
      // room for a morning rush while still stopping brute force.
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/social": { window: 60, max: 30 },
      },
    },
    emailAndPassword: {
      enabled: true, // Admin only (see the /sign-in/email hook)
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    // Endpoints this app never uses: no self sign-up, no email flows, no profile/account changes.
    disabledPaths: [
      "/sign-up/email",
      "/request-password-reset",
      "/reset-password",
      "/reset-password/:token",
      "/send-verification-email",
      "/verify-email",
      "/change-password",
      "/set-password",
      "/update-user",
      "/change-email",
      "/delete-user",
      "/link-social",
      "/unlink-account",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        if (!isAdminEmail(email)) {
          throw new APIError("FORBIDDEN", {
            code: "USE_GOOGLE_SIGN_IN",
            message: "Team Members sign in with Google.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Backstop for every creation path (the DB also has a CHECK constraint). The Admin
          // account is only ever created by scripts/create-admin.mts, never through sign-in.
          before: async (user) => {
            if (!isOrgEmail(user.email) || isAdminEmail(user.email)) throw domainError();
          },
        },
      },
    },
    advanced: {
      database: { generateId: "uuid", joins: true }, // session + user in one query
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-vercel-forwarded-for"] },
      backgroundTasks: { handler: waitUntil },
    },
    plugins: [nextCookies()], // must stay last
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __attendanceAuth?: Auth };

/** Lazily created so builds don't require runtime secrets. */
export function auth(): Auth {
  globalForAuth.__attendanceAuth ??= createAuth();
  return globalForAuth.__attendanceAuth;
}
