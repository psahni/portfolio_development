# Nuvortiq Smart Booking — Implementation Options

**Status: patient-booking-first priority selected. ✅ Clinic settings [#6](https://github.com/psahni/portfolio_development/issues/6) and availability [#7](https://github.com/psahni/portfolio_development/issues/7) merged. Doctor calendar #20, shared booking #24 and patient sign-in/listing #10 are merged. Hosted patient booking #11 is merged into `main`; appointment management follows. Staff management #4 is merged into `main`; receptionist booking and agenda #8 are implemented on this review branch. Use GitHub issues as task specs.**

**Progress:** ✅ M1 foundation, M2.1 access checks and M2.2 shared clinic login are implemented. The [auth revision](specs/AUTH_CODE_REVISION.md) records the flow and checks. Staff management #4 is merged into `main`; receptionist booking and agenda #8 are implemented on this review branch; PIN-change screens and real email delivery remain pending.

Scope: **one clinic, one branch and one doctor**. Multiple clinics/branches are deferred.

The MVP includes native patient booking and an admin/staff interface. PostgreSQL owns bookings; Google Calendar is an optional outbound mirror.

**Approved local addition (#39):** Staff/admin booking confirmation email template and redacted simulated-delivery log after commit, as a localhost development/test fallback when `SMTP_HOST` is absent or blank. Real delivery and sign-in mail (#12) remain deferred.

**Approved cancellation addition (#40):** Any active staff can cancel any future confirmed clinic-created appointment, with a required nonclinical reason; admin-only blocking/rebooking instructions and patient-created cancellation remain enforced. Add date-preserving Confirmed/Cancelled agenda tabs and retain other status history. No cancellation notifications in this slice.

**Current approved slice:** #8 receptionist booking and daily agenda: active admin/staff create appointments through the shared booking service and read `/admin/appointments`; staff may cancel future confirmed clinic-created appointments with a required reason; patient-created cancellation and blocking remain admin-only. Implemented on this review branch; staff management #4 is merged in PR #37. WhatsApp #15 Phase 1 is merged; the post-integration review is recorded in PR #36. Production/dynamic recipients, webhooks, reminders and cancellation messages remain deferred.

**Delivery priority:** Complete working features one approved task at a time. Keep essential access checks, input validation and credential protection; defer sophisticated security infrastructure to the separate M6 security-hardening task.

## Login requirements

- **Shared login page (`/admin`):** Initially show **Email** and **PIN**, with **Send code** below PIN and a **Sign in** button. Admin uses Email + PIN. Staff enter Email and choose Send code; the form switches to only **Code** and **Sign in**, retaining the email from step one. No role selector; the server rejects staff PIN login.
- **Patient:** Enter email and verify a one-time code. Create a new patient automatically after verification; no separate signup. Then continue to booking details and confirmation. Patients can access only their own bookings.
- **Doctor/admin:** Bootstrap creates the initial admin with an email and four-digit PIN. Sign in through `/admin` using that PIN; no emailed login code. The admin can change the PIN later.
- **Staff:** The admin adds the account and permissions. Staff sign in through the admin interface using a one-time code sent by email.
- **Access:** No password login. Keep patient/admin sessions separate, hash PINs and limit attempts. PIN reset requires the admin session and current PIN. SMS login and two-factor setup are deferred.
- **Testing:** `0000` works only with explicit localhost test mode and a requested email code. New patients register after code verification; clinic accounts must already exist and be active. It is rejected in production and cannot reset PINs.

All three approaches below use these login requirements.

## Approach 1 — Staff workflow first (alternative)

Build in small stages and review each working stage with the clinic.

1. **Foundation (M1):** Set up Next.js, TypeScript, Tailwind, shadcn/ui and PostgreSQL with Drizzle. Validate authentication and database compatibility.
2. **Admin and staff login (M2):** Add the shared `/admin` login form, the PIN-change screen and admin-managed staff access. Bootstrap creates only the initial admin.
3. **Doctor and staff booking (M3):** Add the doctor's agenda, availability, receptionist booking and rescheduling. Let the doctor cancel a booking, block that time if unavailable and suggest another time or ask the patient to rebook.
4. **Patient booking (M4):** Add patient email-code sign-in, the hosted booking page, website button, duplicate-submit protection and instant confirmation.
5. **Integrations (M5):** Add optional Google Calendar sync and automatic cancellation emails with suggestions/rebooking links. Validate WhatsApp confirmations/reminders before enabling automation; retain manual links for follow-up.
6. **Launch checks (M6):** Run a separate security-hardening task (shared abuse limits and security review), then complete booking, backup and usability checks before a small pilot.

- **Best for:** Validating how a clinic actually manages appointments.
- **Benefit:** Staff can review scheduling rules before patients use them.
- **Tradeoff:** The patient-facing demo comes later.

## Approach 2 — Patient booking first (Selected)

Prioritize demonstrating the patient journey after completing the same foundation and security work.

1. Keep the completed foundation, login and access checks. Configure clinic/doctor settings and weekly hours in #6; defer staff management and PIN-change screens.
2. Build available slots and the shared booking service, without requiring a receptionist interface first.
3. Add patient email-code login, slot selection, contact entry and confirmation; connect email before real-patient use.
4. Add the doctor's appointment list and basic cancellation to complete the basic MVP.
5. Add staff workflows, integrations and deferred hardening/launch checks afterwards.

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

**Delivery process:** Define acceptance criteria in the GitHub issue, implement one task, verify it and record results in its PR. Review before expanding scope. The patient-booking-first sequence above is selected; other approaches remain references.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md) for the native MVP design. The Google-hosted draft and archived proposals are historical.
