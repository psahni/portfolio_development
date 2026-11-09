# Nuvortiq Smart Booking — MVP Architecture

**Status: native MVP; patient-booking-first delivery selected. Foundation, clinic login, scheduling and the shared booking service are implemented. Patient sign-in/listing is #10; hosted booking follows in #11.**

## Scope and stack

Build a native booking application for **one clinic, one branch and one doctor**. Patients book through the application's hosted page or a website button. PostgreSQL owns availability and appointments; Google Calendar is an optional outbound mirror.

Use Next.js, TypeScript, PostgreSQL, **Drizzle ORM/Drizzle Kit**, Tailwind and shadcn/ui. Keep one modular codebase with areas for authentication, clinic settings, scheduling, booking and notifications. A background worker handles saved email, messaging and Calendar jobs.

Multiple clinics/branches/doctors, tenant infrastructure, payments and clinical records are deferred. Keep clear module boundaries so later enhancements can use deliberate migrations.

## Login and permissions

| User | Login | Access |
| --- | --- | --- |
| Patient | Email + one-time code at `/login` | Book appointments and view only their own linked bookings. |
| Doctor/admin | Bootstrap email + four-digit PIN at `/admin` | Manage appointments, availability, staff, settings and integrations. |
| Staff | Email + one-time code at `/admin` | Manage appointments within permissions assigned by the doctor. |

Admin and staff share the same two-step `/admin` interface, without a role selector or pre-login role detection. Initially show only Email and PIN inputs, Sign in, and a Send code link/button below PIN. The admin signs in with Email + PIN. Staff enter Email and select Send code without filling PIN; after the request succeeds, replace both inputs with one Code input and Sign in. Retain the email from step one in flow state and clear the PIN; code verification submits the retained email and code, never a PIN. The UI state selects the requested method; the server validates the account and credentials. Staff PIN attempts are always rejected. Keep code-request responses generic and do not infer role/method from credential length. This screen is M2 work.

The doctor is the admin. An explicit, idempotent bootstrap creates only the initial admin using an operator-configured email and four-digit PIN. No PIN is hardcoded. The admin adds staff, who receive email login codes; no passwords are used. Admin PIN changes require a staff-scoped admin session and current PIN, and revoke that admin's existing sessions. Forgotten-PIN recovery is later M2 work.

New and returning patients use the same email-code sign-in. Create the patient account only after successful code verification; collect booking details in the later confirmation form. There is no separate patient signup screen.

Use Better Auth with its Drizzle adapter and [email OTP](https://better-auth.com/docs/plugins/email-otp) for patients/approved staff. A small admin-PIN plugin uses library sessions and a separate protected PIN hash. Staff OTP login checks active staff access and rejects admin accounts; the admin uses PIN login instead. Patient registration must never create staff access, and patient sessions cannot open the admin interface, even for the same email. Only the admin creates staff accounts.

Email codes are expiring and single-use. Protect PIN hashes using the server secret and a slow salted hash. Five failed PIN attempts lock the account for 15 minutes using serialized database counters. Use request limits, secure cookies and server-side access checks. SMS login and two-factor setup are deferred.

For local testing only, `AUTH_TEST_MODE=true` enables requested code `0000` for patient sign-in, including automatic registration of new patients. Staff/admin must already exist and be active. No email is sent in this mode. Admin test login uses `0000` instead of the PIN. Production/non-loopback origins reject test mode. It cannot create clinic accounts, reset PINs or bypass disabled accounts/lockout.

M1 isolates patient and staff identities in separate PostgreSQL auth schemas, endpoint paths and cookies. The [auth revision](specs/AUTH_CODE_REVISION.md) adds bootstrap, access checks and the shared clinic login/workspace. Only required patient/staff login/logout handlers are mounted; codes currently use localhost test mode. Patient listings use explicit account ownership. Staff management, PIN-change screens, real email and booking forms remain future tasks; advanced shared abuse controls are deferred to M6.

## Booking and cancellation

- Configure the doctor's weekly hours, holidays, blocked times, duration and buffers.
- Patients sign in before confirming a booking. Receptionist bookings use the same booking rules; link a patient account only through an explicit authorized association.
- After choosing a slot, the patient reviews their name, verified login email and phone in a short form. Selecting or leaving the form creates no reservation; only **Confirm Booking** commits the slot after checking it is still available.
- Lock the doctor's schedule during changes. Database constraints prevent overlapping appointments and blocks.
- Save appointment, reservation, audit, duplicate-request result and any integration jobs together. Confirm only after the transaction commits.
- Duplicate retries safely return the existing result. Rescheduling is atomic; failure preserves the original booking.
- Store appointment instants in UTC, display the clinic's timezone and retain booked duration/buffer snapshots. Schedule edits must not silently invalidate existing bookings.

The doctor can cancel a confirmed appointment, record a short nonclinical reason and suggest another time or ask the patient to rebook. If the doctor is unavailable, block the original time in the cancellation transaction. An automatic email includes the cancelled time, optional suggestion and rebooking link. Suggestions do not reserve slots; recheck availability when the patient books again.

Statuses: `confirmed`, `cancelled`, `completed`, `no_show`. Notification failure does not undo cancellation; retry and flag unresolved notices for staff follow-up.

## Integrations

- **Email bot:** Sends patient login codes, staff login emails and automatic cancellation/rebooking notices through a provider adapter. Deduplicate cancellation notices and show failures to staff. Provider acceptance alone is not proof of delivery.
- **Google Calendar:** Optional outbound create/update/cancel sync to one clinic calendar. The native database remains authoritative during outages. Google events do not block slots, and Google edits do not change native bookings. Encrypt credentials and omit patient contacts from mirrored event details.
- **WhatsApp:** Retain the newer repository requirement to evaluate confirmations and reminders. Validate provider, authorized recipient and messaging permission before enabling automation. Use native booking events, suppress stale reminders after cancellation/rescheduling and prevent duplicate sends. Manual links remain a follow-up option, not proof of delivery.

Save jobs with booking changes; process provider calls after commit with recoverable claims, retries and reconciliation. Select email/messaging providers before integration implementation; no external accounts or messages are authorized by this document.

## Data protection and verification

Collect minimal patient name, email, phone and booking details. Encrypt contact data and provider credentials. Restrict patient queries to authenticated account ownership; never expose bookings through a phone or reference lookup. Use server validation, forged-request protection, rate limits, private-response cache controls and redacted logs.

Review Drizzle migrations; use restricted runtime and separate migration credentials. Test real PostgreSQL overlap/transaction behavior, email-code/PIN flows, patient/admin separation, PIN lockout/reset, production test-mode rejection, cancellation notices and provider failures. Verify backups and encryption-key restoration.

Before real-patient launch, agree on privacy notices, retention, hosting region, providers and support ownership. Known risks include unverified patient phone numbers, lost email access, provider failures and Calendar drift. Proposed defaults remain 20-minute appointments, zero buffers, 60-minute lead time and a 30-day horizon, with clinic timezone selected during setup.

Active guidance is in this file, [DATABASE.md](DATABASE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [../AGENTS.md](../AGENTS.md). Older archived proposals and the Google-hosted draft are historical references.
