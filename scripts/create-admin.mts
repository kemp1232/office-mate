/**
 * Creates (or resets the password of) the v1 Admin account: admin@firstmate.tech.
 *
 *   npm run admin:create                      # prompts for the password (hidden input)
 *   DATABASE_URL=... npm run admin:create     # against another environment
 *
 * The password is never logged or stored anywhere except as a scrypt hash (Better Auth's
 * format) in app.accounts. Public sign-up for this address is blocked by the app.
 * ADMIN_PASSWORD may be set for automated test setups only.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { ADMIN_EMAILS } from "../src/features/auth/roles.ts";

const ADMIN_EMAIL = ADMIN_EMAILS[0];

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, question);
    };
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden(`New password for ${ADMIN_EMAIL}: `);
    const confirm = await promptHidden("Confirm password: ");
    if (password !== confirm) throw new Error("Passwords don't match");
  }
  if (password.length < 12) throw new Error("Use at least 12 characters for the Admin password");

  const hash = await hashPassword(password);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `insert into app.users (name, email, email_verified, updated_at)
       values ('Admin', $1, true, now())
       on conflict (email) do update set email_verified = true, updated_at = now()
       returning id`,
      [ADMIN_EMAIL],
    );
    const userId = rows[0].id;
    const updated = await client.query(
      `update app.accounts set password = $2, updated_at = now()
       where user_id = $1 and provider_id = 'credential'`,
      [userId, hash],
    );
    if (updated.rowCount === 0) {
      await client.query(
        `insert into app.accounts (account_id, provider_id, user_id, password, updated_at)
         values ($1::text, 'credential', $1::uuid, $2, now())`,
        [userId, hash],
      );
    }
    // Force re-login everywhere after a password (re)set.
    await client.query("delete from app.sessions where user_id = $1", [userId]);
    await client.query("commit");
    console.log(`Admin account ready: ${ADMIN_EMAIL}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
