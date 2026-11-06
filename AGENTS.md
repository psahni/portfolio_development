# Nuvortiq Smart Booking — Repository Guidance

**Current phase: Approach 1 implementation approved.** Follow spec-driven development: write concise acceptance criteria before each milestone's code, implement against them, run the relevant checks and record evidence. Start with [M1](docs/specs/M1_FOUNDATION.md). Local scaffolding, dependencies, code, migrations and synthetic tests are authorized. External account setup, real-user messages, paid provisioning and deployment still require appropriate authorization.

Read [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md) and [database design](docs/DATABASE.md). These active documents govern work. The Google-hosted draft and archived native proposals are historical and must not override current decisions. Do not delegate unless explicitly requested.

M1 is implemented and functionally checked; see its evidence and pending browser-QA limitation. The current app is a foundation page, not a working booking product. Auth factories are tested but HTTP handlers are not mounted. The [auth revision](docs/specs/AUTH_CODE_REVISION.md) replaces password login with staff email codes and an admin PIN. M2 must add the admin interface, full staff-management authorization and shared request-abuse limits before mounting public auth handlers. Use [README.md](README.md) for actual commands; dev/build use webpack for this environment.

## Confirmed direction

- Build a **native MVP for one clinic, one branch and one doctor**. Multiple clinics/branches/doctors and SaaS infrastructure are deferred; no tenancy module, tenant IDs or tenant RLS.
- Use Next.js App Router, strict TypeScript, PostgreSQL, **Drizzle ORM/Drizzle Kit**, Tailwind and shadcn/ui. No Prisma. Keep a modular monolith with web and worker runtime roles.
- PostgreSQL owns availability and bookings. Google Calendar is an optional outbound mirror, not the booking engine.
- Patients and approved staff sign in with **email + one-time code**. The doctor/admin uses the bootstrap email and a **four-digit PIN**, without an emailed login code. Password login, SMS login and two-factor setup are out of scope.
- M2 uses the identical `/admin` login form for admin and staff: Email, PIN and Email code fields, plus Send code and Sign in. All controls are visible before login, with no role selector or pre-login role-based disabling. Admin fills PIN; staff request and fill Email code. Exactly one credential field is submitted. Server-side account checks enforce the method; staff can never use PIN, including in test mode.
- The doctor is the admin. Explicit bootstrap creates only that initial account; it is idempotent and never overwrites an existing PIN. The admin creates staff accounts/permissions in M2. Store only protected PIN hashes, enforce persistent PIN lockout and require the current PIN plus an admin session for PIN changes; revoke that admin's sessions on change. No public staff/admin signup.
- Keep patient/admin session boundaries distinct and authorize every protected server action/endpoint. Patient code login must never grant admin access, including when the email matches a staff account. Patients see only explicitly linked bookings.
- The doctor can cancel an appointment, block that time if unavailable and suggest another time or rebooking. Suggestions do not reserve slots. Queue automatic cancellation emails, retry failures and show unresolved notices to staff.
- Retain WhatsApp confirmation/reminder feasibility work from the newer repository proposal. Validate provider, recipient and messaging permission before automation; manual links cannot prove delivery.

## Engineering guardrails

- Public/patient and receptionist paths share scheduling rules. Lock the doctor row, enforce database non-overlap and commit booking/reservation/audit/duplicate-request results and integration jobs together. Confirm only after commit; make reschedules atomic.
- Keep provider calls outside transactions. Use recoverable jobs, bounded retries, duplicate-send protection and reconciliation. A messaging failure must not undo a cancellation.
- Keep patient data minimal, encrypted where appropriate, credentials server-side and diagnostics redacted. Enforce input validation, forged-request protection, abuse limits and private-response cache controls.
- Pin compatible maintained dependencies and one lockfile. Preserve separate login/session boundaries. `AUTH_TEST_MODE=true` allows `0000` only on localhost in development/test for existing active accounts; email-code login still requires a requested live code. Reject test mode in production/non-loopback origins. It never creates accounts, resets PINs or bypasses lockout.
- Test actual PostgreSQL transactions/constraints/migrations, both login flows, patient ownership, staff permissions, concurrent bookings and integration failures. Use synthetic data and authorized test accounts/recipients.
- Review migrations; use least-privilege runtime credentials and separate migration credentials. No production schema push or automatic startup migrations. Verify backup/key restoration before launch.
- Preserve user changes and historical files. Report actual checks and unresolved risks. Resolve privacy, retention, providers, hosting region and operational ownership before real-patient launch.
