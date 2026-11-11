# Nuvortiq Smart Booking

Native booking for one clinic, one branch and one doctor. The selected patient-booking-first approach is delivered through small, reviewed tasks.

**Current delivery:** `/admin` supports clinic sign-in; `/login` supports patient email codes and `/appointments` shows only that patient's linked bookings. `/book` supports patient slot selection, details, review and committed confirmation. My appointments lets patients cancel their own confirmed visits before the start time; cancelled visits stay in history. Real email delivery is still pending.

**Testing now:** Follow the [testing steps](docs/TESTING.md). With localhost `AUTH_TEST_MODE=true`, open `/login`, enter a synthetic email such as `patient@example.test`, request a code and enter `0000`. New patients are created automatically after the code is checked; no signup form or seed command is needed.

**Clinic setup (#6):** After migration, sign in as admin and open **Clinic settings** in the workspace. Save clinic/doctor details, select a timezone, set appointment rules and add weekly opening intervals. Closed days have no intervals; settings persist across restarts.

**Availability (#7):** Open **Availability** in the workspace to preview slots, mark a holiday, set special hours for one date or add/remove a personal break. Restoring weekly hours keeps separately saved breaks. Previewing and selecting a slot do not reserve it; `/book` confirms through the shared booking service.

**Doctor calendar (#20):** Open **Calendar** for Day/Week views: green Available, red Booked and amber Break cards, with text labels. Navigate dates or refresh to see current data in the clinic timezone. This view reads existing reservations, including occupancy saved by patient booking.

**Patient cancellation policy (#32):** Give at least two hours’ notice. Patients may cancel until the visit starts; less than two hours is recorded as a late cancellation and shown in patient/admin history. Exactly two hours is on time. No cancellation fees or automatic booking bans. To change time, cancel and use **Book another appointment**; availability is checked again and the original stays cancelled if the new booking is abandoned. After start, contact the clinic. Older cancellations remain unclassified. Apply the reviewed migration explicitly before using this feature.

**Doctor appointments (#9, first slice):** After applying the reviewed migration, the admin can open **Appointments** to see patient contacts and all visit statuses for a clinic-local date. Cancel a future confirmed visit with a short nonclinical reason, optional rebooking instruction and optional block of its original buffered time. Cancellation keeps history and commits all changes together. Automatic patient notices, rescheduling and status changes remain future work.

## Run locally

Use Node.js 24 LTS (`.nvmrc`) or Node.js 26 and pnpm 12.18.0. Dependencies are pinned in `pnpm-lock.yaml`.

```sh
npx --yes pnpm@12.18.0 install --frozen-lockfile
npx --yes pnpm@12.18.0 dev
```

Open `http://localhost:3000`. The foundation page works without database credentials. The scripts select Next.js's webpack compiler because Turbopack's CSS subprocess cannot bind a port in this execution environment.

If pnpm is already installed at the pinned version, use `pnpm` directly in place of `npx --yes pnpm@12.18.0` below.

## Local PostgreSQL

Option A: `pnpm db:local` starts a real PostgreSQL 17 instance on `127.0.0.1:54329`, stores development data in ignored `.local/postgres`, and stops on Ctrl+C. Run it as your normal user, not root. The platform binary comes from the pinned development-only `embedded-postgres` package; it is not production infrastructure.

Option B: with Docker installed, run `docker compose up -d --wait postgres` instead. Use only one option at a time because both use port 54329.

In a second terminal:

```sh
cp .env.example .env.local
# Edit .env.local. Generate a DIFFERENT value for each auth secret:
openssl rand -base64 48
openssl rand -base64 48
pnpm db:migrate
```

The example database credentials are for loopback development only. Deployments require separate restricted runtime and migration roles. Never commit `.env.local` or reuse example credentials in production. Migration generation (`pnpm db:generate`) needs no live database. Migrations are applied explicitly, never at app startup.

## Admin bootstrap and local test login

After migration, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PIN` in ignored `.env.local`. Choose a four-digit PIN other than reserved test code `0000`, then run:

```sh
pnpm db:bootstrap-admin
```

This creates only the admin. Re-running it preserves the existing PIN and does not create staff or patients. No real admin is created until you supply these settings. The server-side PIN-change service requires the current PIN plus an admin session and signs that admin out everywhere after a change; its screen is M2 work. Forgotten-PIN recovery is also M2 work. Keep the staff auth secret stable: it protects PIN hashes, so rotating it needs a controlled PIN reset.

For localhost testing, explicitly set `AUTH_TEST_MODE=true`. An existing admin can use `0000` instead of their PIN; patients can request a login code and enter `0000` without sending email; a new patient is created only after the code is checked. Approved staff can use the same test code for their existing account. Staff must already be approved and active. Staff can never use the PIN endpoint, including with `0000`; they must request an email login code and use the code-verification flow. Unknown clinic accounts, disabled staff, locked PINs and code replay are rejected. Test mode cannot reset a PIN and is rejected in production or on non-loopback origins. Open `/admin` to try the login flow. Staff accounts must already exist; the staff-management screen is a later task. With test mode disabled, staff email login is unavailable until a provider is connected; admin PIN login still works.

## Checks

```sh
pnpm check                # lint, strict TypeScript, environment/mail unit tests
pnpm test:integration     # starts and removes its own disposable real PostgreSQL
pnpm exec playwright install chromium # once, for browser checks
pnpm test:e2e             # isolated Next.js + PostgreSQL, synthetic login accounts
pnpm build               # production build, no DB/auth credentials needed
pnpm start               # serve the production build
```

Integration tests never connect to an existing development/production database. They generate a random password and local port, replay migrations, and check transactions plus isolated patient/staff email codes, admin PIN bootstrap/reset/lockout and test-mode restrictions. Test login codes are captured only in memory; no email is sent. Platform/database logs and credentials are not echoed. Browser tests use their own temporary source copy and database, preserving the running dev server. A real email provider is a separate task; shared abuse infrastructure is deferred to M6.

CI is configured for GitHub Actions and runs on pushes and pull requests. Check the review branch's Actions results for remote verification. Local test and build evidence is recorded in [M1](docs/specs/M1_FOUNDATION.md). Current login flows are covered by Chromium desktop/mobile checks.

## Spec-driven workflow

1. Define the task's outcome, acceptance criteria and boundaries in its GitHub issue.
2. Implement only that slice and its meaningful behavior tests.
3. Record changed-file purposes, important logic, checks and limitations in its PR description.
4. Review the working milestone before expanding to the next slice.

See [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [database design](docs/DATABASE.md) and [agent guidance](AGENTS.md). The admin workspace provides the hosted `/book` link and a copyable HTML website button. Patients sign in, choose a slot, enter name/phone and review before **Confirm booking** creates occupancy. Calendar and notification jobs remain future integration tasks.
