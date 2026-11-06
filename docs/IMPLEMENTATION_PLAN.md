# Nuvortiq Smart Booking — Implementation Options

**Status: Approach 1 approved. Spec-driven implementation starts with [M1](specs/M1_FOUNDATION.md).**

**Progress:** M1 and the [code/PIN auth revision](specs/AUTH_CODE_REVISION.md) pass 29 tests, typecheck, lint and production build. The revision supersedes password login. Browser visual QA and M2 login forms remain pending.

Scope: **one clinic, one branch and one doctor**. Multiple clinics/branches are deferred.

The MVP includes native patient booking and an admin/staff interface. PostgreSQL owns bookings; Google Calendar is an optional outbound mirror.

## Login requirements

- **Shared login page:** `/admin` for both admin and staff. Admin enters email + PIN; staff enter email + requested email code and can never use PIN login. The requested three-field layout is awaiting clarification of the field labels.
- **Patient:** Enter email, receive a one-time code and sign in to access only their own bookings.
- **Doctor/admin:** Bootstrap creates the initial admin with an email and four-digit PIN. Sign in through `/admin` using that PIN; no emailed login code. The admin can change the PIN later.
- **Staff:** The admin adds the account and permissions. Staff sign in through the admin interface using a one-time code sent by email.
- **Access:** No password login. Keep patient/admin sessions separate, hash PINs and limit attempts. PIN reset requires the admin session and current PIN. SMS login and two-factor setup are deferred.
- **Testing:** `0000` works only with explicit localhost test mode and existing active accounts. Email-code login still requires requesting a code. It is rejected in production and cannot reset PINs.

All three approaches below use these login requirements.

## Approach 1 — Staff workflow first (Recommended)

Build in small stages and review each working stage with the clinic.

1. **Foundation (M1):** Set up Next.js, TypeScript, Tailwind, shadcn/ui and PostgreSQL with Drizzle. Validate authentication and database compatibility.
2. **Admin and staff login (M2):** Add the shared `/admin` login form, the PIN-change screen and admin-managed staff access. Bootstrap creates only the initial admin.
3. **Doctor and staff booking (M3):** Add the doctor's agenda, availability, receptionist booking and rescheduling. Let the doctor cancel a booking, block that time if unavailable and suggest another time or ask the patient to rebook.
4. **Patient booking (M4):** Add patient email-code sign-in, the hosted booking page, website button, duplicate-submit protection and instant confirmation.
5. **Integrations (M5):** Add optional Google Calendar sync and automatic cancellation emails with suggestions/rebooking links. Validate WhatsApp confirmations/reminders before enabling automation; retain manual links for follow-up.
6. **Launch checks (M6):** Complete security, booking, backup and usability checks before a small pilot.

- **Best for:** Validating how a clinic actually manages appointments.
- **Benefit:** Staff can review scheduling rules before patients use them.
- **Tradeoff:** The patient-facing demo comes later.

## Approach 2 — Patient booking first

Prioritize demonstrating the patient journey after completing the same foundation and security work.

1. Complete M1–M2, including admin PIN login, staff email-code login and permissions.
2. Build availability, the shared booking service and the patient page using synthetic clinic data.
3. Demonstrate patient email-code login, slot selection, contact entry and instant confirmation.
4. Add the receptionist agenda, availability management, cancellation and rescheduling.
5. Add integrations and complete the same launch checks as Approach 1.

- **Best for:** Reviewing the booking experience with clinic owners early.
- **Benefit:** The hosted link and website button are demonstrated sooner.
- **Tradeoff:** Staff workflow feedback may require changes to the patient journey.

## Approach 3 — Complete MVP before clinic review

Build the full agreed scope before the first clinic demonstration.

1. Complete M1–M2, including foundation, admin PIN login, staff email-code login and permissions.
2. Build staff booking and patient booking around the same scheduling service.
3. Add optional Google Calendar sync, automatic cancellation emails, WhatsApp feasibility checks and operational monitoring.
4. Test the complete product, collect clinic feedback and fix issues before the pilot.

- **Best for:** A clinic with clear, agreed requirements and limited review availability.
- **Benefit:** The first demonstration covers the entire workflow.
- **Tradeoff:** Feedback arrives later, making changes more expensive.

## Required for every approach

- **Architecture:** Modular monolith; one clinic, one branch, one doctor; Next.js, TypeScript, PostgreSQL, Drizzle, Tailwind and shadcn/ui.
- **Security:** Only authorized staff can access patient records. Patients/staff use email codes; the admin uses a four-digit PIN; patient contacts and secrets stay protected.
- **Booking:** Database-enforced overlap prevention, safe retries, timezone handling and confirmation only after saving succeeds.
- **Integrations:** Google is an optional outbound mirror. Cancellation emails are automatic. WhatsApp confirmations/reminders require provider and permission validation; manual links remain available.

## Doctor cancellation flow

1. Doctor opens a confirmed appointment and selects **Cancel**.
2. Add a short reason and, optionally, another available time. Block the original time if the doctor is unavailable.
3. Save the cancellation and queue an automatic email with the suggestion or booking link.
4. The patient chooses whether to rebook. A suggested time is not reserved; availability is checked again.

The doctor uses the admin account. Collect patient email when booking. The bot retries failed emails and flags unresolved notices for staff follow-up; failure does not undo cancellation.

## Essential checks before launch

- **Vitest:** Availability, timezone rules, appointment changes and message formatting.
- **Real PostgreSQL:** Competing bookings, duplicate submissions, safe rescheduling, cancellation with blocked time and migrations.
- **Playwright:** Patient/staff email codes, admin PIN login/reset, attempt limits, disabled accounts and test-code rejection in production.
- **Failure checks:** Google outages/retries, worker recovery, email-notice retries/duplicates/failures, suggested-slot conflicts, backup restore, mobile use and keyboard access.

Use synthetic patients for development and demonstrations. Resolve hosting region, privacy notices, data retention, recovery procedures and provider choices before real-patient launch. Patient phone numbers remain unverified; patients/staff verify email codes, while the admin uses a PIN.

**Delivery process:** Write a short milestone spec first, implement its acceptance criteria, verify them and record results. Review the working milestone before expanding scope. Approach 1 is selected; Approaches 2 and 3 remain alternatives for reference.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md) for the native MVP design. The Google-hosted draft and archived proposals are historical.
