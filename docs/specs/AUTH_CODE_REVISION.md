# Authentication revision — codes and admin PIN

**Status: auth foundation implemented and verified.** This supersedes M1's password-login criteria. Public login forms remain M2/M4.

## Confirmed behavior

- Patients and approved staff sign in with an emailed, expiring one-time code. No password login.
- The doctor/admin signs in with the bootstrap email and a persistent four-digit PIN, without an emailed login code.
- An explicit bootstrap command creates only the initial admin. Repeating it does not reset the PIN or create staff. Public staff/admin signup is disabled; staff creation remains admin-managed in M2.
- Admin can change the PIN after signing in and proving the current PIN. A PIN change revokes all sessions for that admin. Forgotten-PIN email recovery is separate M2 work.
- `0000` is a test login code only when `AUTH_TEST_MODE=true`, the runtime is development/test and the app origin is loopback. Reject this setting in production or on non-local origins.
- Test email-code login still requires a requested, unexpired code and an existing account; it skips real email delivery. The admin may use `0000` instead of their PIN in test mode. It cannot bootstrap accounts, change the PIN or bypass disabled-account/lockout checks.

## Acceptance criteria

| ID | Behavior / evidence |
| --- | --- |
| C1 | Patient and staff email-code sessions remain isolated, including the same email. Staff codes work only for active, pre-approved staff; admin cannot use the staff email-code route. Password signup/sign-in is disabled. |
| C2 | Bootstrap is transactional and idempotent. One admin only; normal PINs are exactly four digits and cannot be reserved test code `0000`. Store only a salted hash of server-secret-protected PIN material. |
| C3 | Admin PIN login requires an active admin. Five failed attempts lock the account for 15 minutes using database-backed, serialized counters. Correct PIN cannot bypass a lock. |
| C4 | PIN reset requires the admin's staff-scoped session and current PIN. Staff/patient sessions cannot reset it. Old PIN and sessions stop working after a successful change. |
| C5 | Test-mode configuration is server-only, explicit and rejected in production/non-loopback deployments. `0000` is rejected when disabled and for unknown or inactive accounts. |
| C6 | Use an additive Drizzle migration; retain published M1 migration history. Replay on fresh PostgreSQL and test upgrade from the original migration. |
| C7 | Unit/integration tests, typecheck, lint and production build pass. No real email or accounts are provisioned during verification. |

## Boundaries

Keep Better Auth session/cookie handling and separate patient/staff stores. Add a small admin-PIN plugin and one staff-access table. Public auth handlers stay unmounted until M2 adds shared request-abuse policies and forms. Bootstrap secrets come from ignored environment configuration, never source defaults or command-line arguments.

Four-digit PINs have limited entropy, so PIN hashing, persistent lockout and request throttling are required. Staff auth secret rotation requires a controlled PIN reset because that secret protects the stored PIN material.

## Shared login screen — M2, planned

- One `/admin/login` screen for both admin and staff: **Email** and **PIN or code** inputs, with **Send code** and **Sign in** buttons.
- Admin enters the PIN directly. Staff first request an email code and then enter it in the same field.
- Resolve the allowed method through server-side account checks; credential length never determines role or privileges. Verify that local staff code `0000` still uses the requested-code flow.
- This is the UI contract for M2; the screen is not implemented or verified in this foundation revision.

## Verification

- `pnpm test`: **12 passing unit tests**, including default-off test mode and rejection in production/non-loopback origins.
- `pnpm test:integration`: **16 passing real PostgreSQL tests**, including the bootstrap CLI with synthetic credentials, idempotent bootstrap, migration upgrade, staff approval, PIN concurrency/lockout/reset/session revocation and test-code boundaries.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`, and `pnpm build`: passed. Production build still needs no live credentials.
- Drizzle generation reports no schema changes after `0001_staff_code_access.sql`; the published `0000_auth_foundation.sql` is unchanged.
- No real email, cloud services or real admin accounts were created. Supply bootstrap email/PIN locally and apply migrations before running `pnpm db:bootstrap-admin`.
- Admin/PIN forms, forgotten-PIN recovery, staff-management UI and public auth handlers remain future milestone work. Existing visual browser-QA limitation is unchanged.
