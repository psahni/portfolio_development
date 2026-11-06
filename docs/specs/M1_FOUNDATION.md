# M1 — Foundation specification

**Approach 1 approved. Status: foundation implemented; visual browser QA pending. The [code/PIN revision](AUTH_CODE_REVISION.md) supersedes the original password-login design.**

## Outcome

A runnable Next.js foundation with PostgreSQL/Drizzle migrations and a tested authentication boundary. M1 does not deliver appointment booking or live email/Calendar integration.

## Acceptance criteria

| ID | Required behavior | Verification |
| --- | --- | --- |
| F1 | App runs with strict TypeScript, Tailwind and owned shadcn/ui components. | Typecheck, lint, production build and local browser smoke check. |
| F2 | Invalid runtime configuration fails with field names, without exposing secret values. Public pages can build without a database connection. | Environment tests and build without credentials. |
| F3 | Drizzle migrations apply to an empty real PostgreSQL database; connectivity uses a bounded `pg` pool. | Migration replay and SQL connectivity/transaction checks. |
| F4 | Patients/staff use email codes; the bootstrap admin uses a four-digit PIN. Separate auth stores, paths and cookies prevent cross-interface access, even with the same email. | Real PostgreSQL auth integration tests for both directions. |
| F5 | Public staff/admin signup and password login are disabled. Staff OTP requires active staff access; admin uses PIN login. Codes expire and are single-use. Local test code cannot work in production. | Positive and negative auth tests, including code replay/expiry. |
| F6 | No real messages are sent. A test mail adapter captures codes only in memory; unconfigured delivery fails clearly. | Integration tests and configuration review. |
| F7 | Fresh checkout has documented, reproducible install, checks, local database and test commands. CI runs the same essential checks. | README, lockfile and CI configuration. |

## Decisions

- Use the requested Next.js/Drizzle stack and a pinned pnpm version; select compatible stable dependencies.
- Better Auth patient and staff instances use separate PostgreSQL namespaces and cookie prefixes. This avoids deriving admin privileges from patient authentication.
- The auth revision implements explicit admin bootstrap, PIN change/lockout and active staff checks. Admin forms, full staff management and shared request-abuse policies remain M2. Public handlers stay unmounted.
- Keep auth code server-only. Do not publish auth handlers until M2/M4 add the appropriate access and abuse policies.
- Use a local disposable PostgreSQL for integration tests; Docker Compose remains an alternative. Never use a production database for tests.
- Development-only exception: `embedded-postgres` uses a beta-versioned Node wrapper around a stable PostgreSQL 17 binary. It is not a production dependency; pin it and explicitly allow only its platform build scripts and esbuild. Production dependencies use stable releases.
- Selecting a future appointment slot is advisory. Only **Confirm Booking** commits occupancy; leaving the form makes no reservation. This is an M3/M4 requirement, not an M1 feature.

## Verification record

Verified locally on Node.js 26.13.0 with pnpm 12.18.0 and real PostgreSQL 17.11:

| Criteria | Evidence | Result |
| --- | --- | --- |
| F1 | `pnpm typecheck`, `pnpm lint`, `pnpm build` (webpack); localhost HTTP 200, title/content and security headers. | Functional checks passed. Visual browser check pending. |
| F2, F6 | `pnpm test`: 12 environment/mail tests, including redacted errors and unconfigured mail failure. Build succeeds without auth/database secrets. | Passed. |
| F3 | `pnpm test:integration`; migration CLI applied to localhost development DB; repeat migration and rollback tested. `pnpm db:generate --name=verify_drift` reports no changes. | Passed. |
| F4, F5 | 16 integration tests using disposable PostgreSQL: bootstrap CLI, additive migration upgrade, same-email isolation, approved-staff codes, admin PIN/reset/lockout, rejected password routes, OTP expiry/replay and local test-code boundaries. | Passed. |
| F7 | `pnpm install --frozen-lockfile`, exact pins, README/local PostgreSQL startup, CI definition. | Local install/checks passed; remote CI not run. |

`pnpm audit --prod --audit-level=high` reported no known vulnerabilities at verification time. This is an advisory check, not a security certification.

Limitations: Turbopack cannot bind its CSS subprocess port in this environment, so dev/build scripts use supported webpack mode. Computer-use browser inventory reported an unavailable host and native browser access timed out; visual/mobile browser QA is **not verified**. An offline frozen install lacked registry metadata required by pnpm policy checks; the online frozen install passed.

The M1 review slice is ready. Do not call the full milestone visually verified until that check is completed. M2 will specify and implement admin forms, staff management, shared request-abuse controls and forgotten-PIN recovery. Patient booking remains M4; no real email, Calendar, WhatsApp or deployment occurred. Later milestone specs must precede their code changes.
