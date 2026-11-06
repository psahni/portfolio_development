# Nuvortiq Smart Booking — MVP Architecture

**Status: native MVP and Approach 1 approved; spec-driven implementation begins with M1.**

## Scope and stack

Build a native booking application for **one clinic, one branch and one doctor**. Patients book through the application's hosted page or a website button. PostgreSQL owns availability and appointments; Google Calendar is an optional outbound mirror.

Use Next.js, TypeScript, PostgreSQL, **Drizzle ORM/Drizzle Kit**, Tailwind and shadcn/ui. Keep one modular codebase with areas for authentication, clinic settings, scheduling, booking and notifications. A background worker handles saved email, messaging and Calendar jobs.

Multiple clinics/branches/doctors, tenant infrastructure, payments and clinical records are deferred. Keep clear module boundaries so later enhancements can use deliberate migrations.

## Login and permissions

| User | Login | Access |
| --- | --- | --- |
| Patient | Email + one-time code at `/login` | Book appointments and view only their own linked bookings. |
| Doctor/admin | Email + password at `/admin/login` | Manage appointments, availability, staff, settings and integrations. |
| Staff | Email + password at `/admin/login` | Manage appointments within permissions assigned by the doctor. |

The doctor is the admin. Initial admin access is configured during setup. The doctor adds staff and emails an expiring temporary password; staff must change it before accessing patient data. Resending credentials invalidates the previous temporary password. Store secure password hashes, never readable passwords; keep credentials out of logs. Use expiring reset links for later password recovery.

Use Better Auth with its Drizzle adapter, [email OTP](https://better-auth.com/docs/plugins/email-otp) for patients and [email/password authentication](https://better-auth.com/docs/authentication/email-password) for doctor/staff. Validate compatibility and separate patient/admin session boundaries in M1. Patient registration must never create staff access, and a patient-code session must not open the admin interface, even for an email also used by staff. Only the admin creates staff accounts; there is no public staff signup.

Codes are expiring and single-use. Limit code sends, password attempts and resets; use secure cookies, server-side role checks and session revocation. SMS login and two-factor setup are deferred.

M1 isolates patient and staff identities in separate PostgreSQL auth schemas, endpoint paths and cookie prefixes. This boundary is tested; public auth handlers, shared abuse policies, role enforcement and temporary-password activation are M2/M4 work. See [M1 specification](specs/M1_FOUNDATION.md).

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

- **Email bot:** Sends patient login codes, staff setup/reset emails and automatic cancellation/rebooking notices through a provider adapter. Deduplicate cancellation notices and show failures to staff. Provider acceptance alone is not proof of delivery.
- **Google Calendar:** Optional outbound create/update/cancel sync to one clinic calendar. The native database remains authoritative during outages. Google events do not block slots, and Google edits do not change native bookings. Encrypt credentials and omit patient contacts from mirrored event details.
- **WhatsApp:** Retain the newer repository requirement to evaluate confirmations and reminders. Validate provider, authorized recipient and messaging permission before enabling automation. Use native booking events, suppress stale reminders after cancellation/rescheduling and prevent duplicate sends. Manual links remain a follow-up option, not proof of delivery.

Save jobs with booking changes; process provider calls after commit with recoverable claims, retries and reconciliation. Select email/messaging providers before integration implementation; no external accounts or messages are authorized by this document.

## Data protection and verification

Collect minimal patient name, email, phone and booking details. Encrypt contact data and provider credentials. Restrict patient queries to authenticated account ownership; never expose bookings through a phone or reference lookup. Use server validation, forged-request protection, rate limits, private-response cache controls and redacted logs.

Review Drizzle migrations; use restricted runtime and separate migration credentials. Test real PostgreSQL overlap/transaction behavior, both login flows, patient/admin separation, staff password activation/reset, cancellation notices and provider failures. Verify backups and encryption-key restoration.

Before real-patient launch, agree on privacy notices, retention, hosting region, providers and support ownership. Known risks include unverified patient phone numbers, lost email access, provider failures and Calendar drift. Proposed defaults remain 20-minute appointments, zero buffers, 60-minute lead time and a 30-day horizon, with clinic timezone selected during setup.

Active guidance is in this file, [DATABASE.md](DATABASE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [../AGENTS.md](../AGENTS.md). Older archived proposals and the Google-hosted draft are historical references.
