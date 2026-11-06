# Nuvortiq Smart Booking — Repository Guidance

## Current phase

**Design review only.** The user requested planning and has not approved implementation. Documentation changes are allowed. Do not scaffold, install dependencies, write feature code/migrations, provision services or deploy until explicitly approved.

The workspace was empty at initial inspection, with no Git repository, application, tests or existing agent guidance. Do not claim implementation or passing tests that do not exist.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Later explicit user instructions take precedence; keep all documents aligned with accepted decisions. Do not delegate to sub-agents unless explicitly requested by the user or applicable instructions.

## Confirmed MVP scope

- **One clinic, one branch, one doctor.** This replaces the original multi-tenant proposal. Multiple clinics/branches/doctors are deferred.
- Do not introduce tenant IDs, memberships between clinics, clinic switching, SaaS onboarding, tenant RLS or a tenancy module.
- Use Next.js App Router, strict TypeScript, PostgreSQL, **Drizzle ORM/Drizzle Kit**, Tailwind and shadcn/ui. Do not introduce Prisma.
- Keep one modular codebase with web and background-worker runtime roles. Separate staff identity from the doctor's booking profile.
- Staff use owner-approved accounts and **email-only one-time-code login** with Better Auth and its Drizzle adapter. Passwords, SMS login and two-factor setup are outside MVP scope.
- The doctor uses the owner account and can manage appointments, staff, settings and Google; receptionists manage appointments. The initial owner is configured during setup.
- Google Calendar is an optional outbound mirror. External busy blocking and two-way sync are deferred. A background notification bot sends automatic cancellation emails; collect patient email at booking. Existing WhatsApp links use manual sending; a WhatsApp bot is deferred.

## Security and booking rules

- Check the active staff session and role inside every protected action/endpoint/service. UI restrictions do not authorize requests. Disable public staff signup and uncontrolled account linking.
- Login codes expire, are single-use, have resend/attempt limits and never appear in logs. Define email recovery and revoke sessions when access is removed. Prevent removal of the last owner.
- Public routes expose only booking information, not existing patient records. A phone number or booking reference alone cannot retrieve private data.
- Validate input, parameterize queries, protect mutations against forged requests and rate-limit public booking/login. Do not cache private responses.
- Encrypt patient contacts and integration credentials. Keep secrets server-side; redact patient data, login codes and tokens from diagnostics. Use restricted runtime DB credentials and separate migration credentials.
- Public and receptionist booking use the same service. Lock the doctor row for scheduling changes and enforce a database overlap constraint for appointments and manual blocks.
- Commit appointment/reservation/audit/duplicate-request records and any Calendar/notification jobs together before confirming. Keep retries safe, reschedules atomic and stale edits detectable.
- The doctor can cancel a confirmed appointment, record a short nonclinical reason and suggest another time or invite rebooking. If unavailable, block the original time in the same transaction. A suggestion does not reserve or change the patient's booking; recheck availability when they rebook. Queue an automatic cancellation email with the suggested time or rebooking link in the cancellation transaction. Deduplicate notices, retry failures and flag unresolved delivery for staff follow-up. Keep notification outcome separate from cancellation and never undo cancellation because delivery fails.
- Store appointment instants in UTC and working hours in the clinic's timezone. Preserve booked duration/buffer snapshots; handle daylight-saving changes explicitly.
- Keep provider calls outside DB transactions. Use saved jobs, recoverable worker claims, bounded retries, duplicate-event protection and reconciliation.
- Collect minimal patient data; no clinical records. Resolve privacy, retention, region and provider decisions before real-patient launch.

## Verification and change hygiene

- Pin compatible maintained dependency versions and a pnpm lockfile after approval; validate auth/Drizzle compatibility early.
- Use real PostgreSQL to verify overlap constraints, transactions, migrations and concurrent booking. Test staff/public permissions, expired/reused codes, retries, reschedules, doctor cancellation/unavailability, suggested-slot conflicts and notification failures.
- Use synthetic patients, a test mailbox and a dedicated test calendar. Do not send real-user messages, provision paid resources or deploy without authorization.
- Review generated SQL and commit migration history. No production schema push or automatic startup migrations. Verify backup and encryption-key restoration before launch.
- Preserve user changes. Make focused edits and update documentation when scope changes. Do not initialize Git just to manufacture a diff during planning.
- Report actual verification results and remaining risks. Keep proposed, implemented and verified behavior distinct.
