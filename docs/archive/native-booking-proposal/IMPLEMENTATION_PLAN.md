# Nuvortiq Smart Booking — Implementation Options

**Status: awaiting review. No implementation has started.**

Scope: **one clinic, one branch and one doctor**. Multiple clinics/branches are deferred.

All three approaches deliver the same MVP. They differ in build order and when clinic feedback is collected.

## Approach 1 — Staff workflow first (Recommended)

Build in small stages and review each working stage with the clinic.

1. **Foundation (M1):** Set up Next.js, TypeScript, Tailwind, shadcn/ui and PostgreSQL with Drizzle. Validate authentication and database compatibility.
2. **Staff login (M2):** Sign in with a code sent by email. Let the owner add receptionists and control staff permissions. No password, SMS login or two-factor setup is required.
3. **Doctor and staff booking (M3):** Add the doctor's agenda, availability, receptionist booking and rescheduling. Let the doctor cancel a booking, block that time if unavailable and suggest another time or ask the patient to rebook.
4. **Patient booking (M4):** Add the hosted booking page, website button, duplicate-submit protection and instant confirmation.
5. **Integrations (M5):** Add Google Calendar sync and a notification bot that automatically emails cancellation details, a suggested time or a rebooking link. Keep WhatsApp links for manual messaging.
6. **Launch checks (M6):** Complete security, booking, backup and usability checks before a small pilot.

- **Best for:** Validating how a clinic actually manages appointments.
- **Benefit:** Staff can review scheduling rules before patients use them.
- **Tradeoff:** The patient-facing demo comes later.

## Approach 2 — Patient booking first

Prioritize demonstrating the patient journey after completing the same foundation and security work.

1. Complete M1–M2, including email-code login and staff permissions.
2. Build availability, the shared booking service and the patient page using synthetic clinic data.
3. Demonstrate slot selection, contact entry and instant confirmation.
4. Add the receptionist agenda, availability management, cancellation and rescheduling.
5. Add integrations and complete the same launch checks as Approach 1.

- **Best for:** Reviewing the booking experience with clinic owners early.
- **Benefit:** The hosted link and website button are demonstrated sooner.
- **Tradeoff:** Staff workflow feedback may require changes to the patient journey.

## Approach 3 — Complete MVP before clinic review

Build the full agreed scope before the first clinic demonstration.

1. Complete M1–M2, including foundation, email-code login and staff permissions.
2. Build staff booking and patient booking around the same scheduling service.
3. Add Google Calendar, WhatsApp links and operational monitoring.
4. Test the complete product, collect clinic feedback and fix issues before the pilot.

- **Best for:** A clinic with clear, agreed requirements and limited review availability.
- **Benefit:** The first demonstration covers the entire workflow.
- **Tradeoff:** Feedback arrives later, making changes more expensive.

## Required for every approach

- **Architecture:** Modular monolith; one clinic, one branch, one doctor; Next.js, TypeScript, PostgreSQL, Drizzle, Tailwind and shadcn/ui.
- **Security:** Only authorized staff can access patient records. Staff use email-only code login and owner/receptionist permissions; patient contacts and secrets stay protected.
- **Booking:** Database-enforced overlap prevention, safe retries, timezone handling and confirmation only after saving succeeds.
- **Integrations:** Google is an outbound mirror. Cancellation emails are automatic; WhatsApp links require manual sending. A WhatsApp bot is deferred.

## Doctor cancellation flow

1. Doctor opens a confirmed appointment and selects **Cancel**.
2. Add a short reason and, optionally, another available time. Block the original time if the doctor is unavailable.
3. Save the cancellation and queue an automatic email with the suggestion or booking link.
4. The patient chooses whether to rebook. A suggested time is not reserved; availability is checked again.

The doctor uses the owner account. Collect patient email when booking. The bot retries failed emails and flags unresolved notices for staff follow-up; failure does not undo cancellation.

## Essential checks before launch

- **Vitest:** Availability, timezone rules, appointment changes and message formatting.
- **Real PostgreSQL:** Competing bookings, duplicate submissions, safe rescheduling, cancellation with blocked time and migrations.
- **Playwright:** Patient/staff workflows, code login, expired/reused codes, login attempt limits and unauthorized access.
- **Failure checks:** Google outages/retries, worker recovery, email-notice retries/duplicates/failures, suggested-slot conflicts, backup restore, mobile use and keyboard access.

Use synthetic patients for development and demonstrations. Resolve hosting region, privacy notices, data retention, recovery procedures and provider choices before real-patient launch. Patient phone numbers remain unverified; staff must verify their login codes.

**Next step:** Review these options and approve an approach before implementation. Approach 1 is recommended for early clinic feedback.

Technical details and the full assumptions/risk register remain in [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md).
