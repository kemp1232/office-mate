# Deployment — Vercel + Supabase Postgres

Nothing below has been performed against real First Mate accounts yet; each step needs someone with the
relevant dashboard access. Tick them off in order.

## 1. Supabase project

1. Create a project (region close to Manila, e.g. **Southeast Asia (Singapore)**), Postgres 17.
2. Link and push migrations from this repo:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push            # applies supabase/migrations only (seed.sql is local-only)
   ```
   Upgrading an existing project: `supabase db push` applies only the new migrations. The team
   migration (`20261001000005_team_members.sql`) splits every existing user's name into first/last
   (last word = last name), adds the prefilled team list (existing emails only get their names
   updated), and adds Clock Out rules, today's overrides and deactivation. It changes no attendance rows.
3. Give the runtime role a password (SQL editor, run as `postgres`) — generate it in a password manager:
   ```sql
   alter role attendance_app with login password '<32+ random characters>';
   ```
4. **Disable the Data API** (Dashboard → Integrations → Data API → off). The app never uses PostgREST and
   the `app` schema isn't exposed, but switching it off removes the surface entirely.
5. Build the runtime connection string from Dashboard → Connect → **Transaction pooler** (port 6543),
   replacing the user with the custom role:
   ```
   postgresql://attendance_app.<project-ref>:<password>@<pooler-host>:6543/postgres
   ```
   (Custom roles log in through Supavisor as `<role>.<project-ref>`.)

## 2. Google Workspace SSO (Team Members)

Done by a Google Workspace admin for `firstmate.tech`, in Google Cloud Console:

1. Create (or pick) a Google Cloud project **inside the firstmate.tech organisation**.
2. APIs & Services → **OAuth consent screen** → User type **Internal** (only firstmate.tech accounts can
   use it). App name "Office Mate", support email, the app domain. Scopes: `openid`, `email`,
   `profile` (the defaults — no sensitive scopes).
3. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → _Web application_:
   - Authorised JavaScript origins: `https://<your domain>` (and `http://localhost:3000` for local dev)
   - Authorised redirect URIs: `https://<your domain>/api/auth/callback/google`
     (and `http://localhost:3000/api/auth/callback/google` for local dev)
4. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (step 3).

The app itself enforces the domain too: Better Auth's Google provider is configured with
`hd: "firstmate.tech"` and rejects any ID token whose verified hosted-domain claim differs; the database
only accepts `@firstmate.tech` users. Personal Gmail accounts are refused even if the consent screen
were made External. No email/SMTP service is needed.

## 2b. Google Sheets sync (service account)

Follow [`google-sheets-sync.md`](google-sheets-sync.md) → Setup: enable the Google Sheets API, create a
service account + JSON key, share the report Sheet with its email as **Editor**.

## 3. Vercel project

1. Import the Git repository (framework: Next.js; build `npm run build`; install `npm install`).
2. Settings → General → Node.js version **24.x**.
3. Environment variables (Production, and Preview if you use previews):

   | Name                           | Value                                                                         |
   | ------------------------------ | ----------------------------------------------------------------------------- |
   | `DATABASE_URL`                 | the attendance_app pooler URL from step 1.5                                   |
   | `BETTER_AUTH_SECRET`           | `openssl rand -base64 32` (different per environment)                         |
   | `BETTER_AUTH_URL`              | `https://<your production domain>` (e.g. `https://attendance.firstmate.tech`) |
   | `ATTENDANCE_TIMEZONE`          | `Asia/Manila`                                                                 |
   | `GOOGLE_CLIENT_ID`             | from step 2                                                                   |
   | `GOOGLE_CLIENT_SECRET`         | from step 2                                                                   |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | from step 2b                                                                  |
   | `GOOGLE_SERVICE_ACCOUNT_KEY`   | from step 2b (the JSON key's `private_key`)                                   |

   Do **not** add `DATABASE_ADMIN_URL`, and never prefix secrets with `NEXT_PUBLIC_`.

4. (Optional) add a custom domain; update `BETTER_AUTH_URL` to match, then redeploy.
5. Deploy. HTTPS is automatic (geolocation only works on HTTPS).

**Preview deployments:** they use whatever `DATABASE_URL` the Preview scope has. Point Preview at a
separate Supabase project/branch before inviting testers so test clock-ins never reach production data,
and set Preview `BETTER_AUTH_URL` per branch or keep previews behind Vercel Deployment Protection.

## 4. Admin account

From a trusted machine (the password is prompted with hidden input and stored only as a scrypt hash):

```bash
DATABASE_URL='postgresql://attendance_app.<ref>:<pw>@<pooler-host>:6543/postgres' npm run admin:create
```

Re-run the same command to reset the Admin password (it also signs the Admin out everywhere).
There is no password reset by email: re-running this script is the reset. The Admin signs in at
`/login/admin` (the password form refuses every other address, and Google sign-in can't attach to the
Admin account).

## 5. First-run configuration (Admin)

1. Open `https://<domain>/login/admin` → sign in as `admin@firstmate.tech`.
2. The Attendance screen shows **Attendance setup incomplete** → **Open settings**.
3. On the map, tap the office (or **Use my location** while in the office), drag to fine-tune.
4. Check radius (default 300 m) and GPS accuracy threshold (default 50 m; raise toward 300 m if indoor
   phones struggle), confirm the report link, **Save settings**.
5. Open the QR page (QR icon in the header) → **Print QR code** → post it at the entrance.

## 6. Production smoke test

- [ ] Phone camera scans the printed QR → app opens at `/attendance?source=qr` → redirected to sign in.
- [ ] On `/login`, **Continue with Google** with a real `@firstmate.tech` account → you land back on Attendance.
- [ ] A personal Google account (e.g. `@gmail.com`) is refused with "Use your @firstmate.tech Google Workspace account".
- [ ] The Admin signs in at `/login/admin` with email + password.
- [ ] At the office: Clock In → location prompt → "You're at the office" → Clocked in card.
- [ ] Clock Out → "Attendance complete for today".
- [ ] Away from the office (or with location denied) you get the plain-language error and nothing is recorded.
- [ ] A Team Member opening `/admin/settings` is sent back to Attendance.
- [ ] Add to Home Screen on iOS Safari and Android Chrome; launch from the icon; check the header and
      bottom button clear the notch / home indicator.
- [ ] The report Google Sheet gets a tab named after today (e.g. "October 13, 2026") with your row.
- [ ] In Supabase Table Editor (`app.attendance_events`) the two rows show `source = QR`, the office
      snapshot and distance.

## Operations notes

- Attendance rows can't be updated or deleted (triggers block it for every role). Users with attendance
  history can't be deleted either. This is intentional for v1.
- To change the organisation timezone, change `ATTENDANCE_TIMEZONE` and redeploy (existing rows keep
  their recorded day).
- Rotating `BETTER_AUTH_SECRET` signs everyone out; Better Auth supports `BETTER_AUTH_SECRETS` for rotation.
- OpenFreeMap has no SLA; it's only used by the Admin map, never by Clock In/Out.
