# Nuvortiq Smart Booking

Native booking for one clinic, one branch and one doctor. Approach 1 is being built through short specifications and verified milestones.

**Current delivery: M1 foundation.** The Next.js shell, Drizzle auth migrations and patient/staff authentication feasibility tests are implemented. Patient booking, admin forms, staff provisioning, password activation and live integrations are later milestones. Authentication handlers are intentionally not mounted publicly yet.

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

## Checks

```sh
pnpm check                # lint, strict TypeScript, environment/mail unit tests
pnpm test:integration     # starts and removes its own disposable real PostgreSQL
pnpm build               # production build, no DB/auth credentials needed
pnpm start               # serve the production build
```

Integration tests never connect to an existing development/production database. They generate a random password and local port, replay migrations, and check transactions plus patient-code/staff-password authentication in both directions. Test login codes are captured only in memory; no email is sent. Platform/database logs and credentials are not echoed. A configured email provider and shared abuse limits are required before public auth handlers are added.

CI is configured for GitHub Actions and runs on pushes and pull requests. Check the review branch's Actions results for remote verification. Local test and build evidence is recorded in [M1](docs/specs/M1_FOUNDATION.md). Browser visual QA remains unverified where computer/browser automation is unavailable.

## Spec-driven workflow

1. Write the milestone's outcome, acceptance criteria and boundaries under `docs/specs/`.
2. Implement only that slice and its meaningful behavior tests.
3. Record actual checks and remaining limitations in the spec.
4. Review the working milestone before expanding to the next slice.

See [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [database design](docs/DATABASE.md) and [agent guidance](AGENTS.md). The website button will open the native booking page. Selecting a slot will not reserve it; only a committed **Confirm Booking** action will create occupancy and queue Calendar sync.
