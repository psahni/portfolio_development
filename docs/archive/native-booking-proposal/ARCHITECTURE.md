# Nuvortiq Smart Booking — MVP Architecture

**Status: design review. No implementation has started.**

## Scope

Build a booking application for **one clinic, one branch and one doctor**. This replaces the earlier multi-clinic proposal.

- Patients book through a hosted page or a button on the clinic's website.
- The doctor uses the owner account to manage availability and appointments; receptionists also manage bookings.
- The doctor can cancel appointments and notify patients with a suggested time or a request to rebook.
- Patients receive instant on-screen confirmation after the booking is saved.
- Google Calendar receives appointment updates. A notification bot sends automatic cancellation emails; WhatsApp messages use manually opened links.

Multiple clinics, branches and doctors are future enhancements. The MVP has one application and one database, with no tenant onboarding, clinic switching, tenant IDs or tenant-isolation policies.

At initial inspection the repository was empty, with no application, Git repository or existing agent guidance. Only planning documents have been created by this work.

## Application structure

Use a **modular monolith**: one TypeScript codebase with separate areas for staff access, clinic settings, scheduling, booking and integrations.

- **Next.js:** Public booking page, staff dashboard and server endpoints.
- **PostgreSQL + Drizzle:** Application data, booking transactions and migrations.
- **Background worker:** Processes saved Calendar updates and patient notification emails from the same codebase.
- **Tailwind + shadcn/ui:** Responsive forms and dashboard components.

Pages and endpoints call application services. Services handle permissions and booking rules; database access stays on the server. Keep Google network calls outside booking transactions.

Suggested areas: `identity`, `clinic`, `scheduling`, `booking`, `calendar`, `notifications` and `jobs`. No tenancy module is needed.

Routes can be simple: `/book`, `/confirmation`, `/admin`, `/api/public/bookings` and the authentication/Google callback endpoints. No clinic slug is required. A website button links directly to `/book`.

## Staff login and permissions

Staff enter an approved email address, receive a one-time code and enter it to sign in. **Email only; no password or two-factor setup.** SMS login is deferred.

Use Better Auth with its Drizzle adapter and [email OTP plugin](https://better-auth.com/docs/plugins/email-otp). Validate compatibility during M1. Initial owner access is set up during deployment; the owner can add or invite receptionists by email. Public visitors cannot create staff accounts or gain access simply by verifying an email.

| Role | Permissions |
| --- | --- |
| Owner (doctor) | Manage appointments, including cancellation and alternative-time suggestions, clinic/doctor settings, staff access and Google Calendar connection. |
| Receptionist | View the agenda and book, reschedule or cancel appointments. |

Require an active staff account and check permissions on every protected action and endpoint. Prevent removal of the last owner. Use expiring, single-use login codes, resend/attempt limits, secure session cookies and session revocation. Define email-change and lost-email recovery procedures before launch.

Public patients can see available slots and their own minimal confirmation. They cannot browse patient records or the staff dashboard.

## Booking rules

- One doctor and one configurable appointment type initially.
- Configure weekly hours, holidays, special hours, appointment duration and buffers.
- Public and receptionist bookings use the same booking service and availability rules.
- Lock the doctor's schedule while validating changes. A database overlap constraint prevents appointments and manual blocks from occupying the same time.
- Save the appointment, reservation, audit record, duplicate-request result and any Calendar/notification jobs in one transaction. Confirm only after commit.
- Repeated submissions safely return the existing booking within the retry window.
- Cancellation releases the booking. If the doctor is unavailable at that time, create a manual block in the same transaction so patients cannot immediately book it again. Rescheduling saves both changes together; failure preserves the original booking.
- Changes to hours or settings must not silently invalidate existing appointments.
- Store appointment instants in UTC and display them in the clinic's configured timezone. Keep booked duration/buffer snapshots.

Statuses: `confirmed`, `cancelled`, `completed`, `no_show`. A reschedule retains the appointment ID and records the change.

## Doctor cancellation and patient rebooking

The doctor opens a confirmed appointment, cancels it and records a short nonclinical reason. They may suggest another available time or simply ask the patient to rebook. The notification bot emails the patient the cancelled appointment time, suggestion when provided, clinic contact and a booking link. Collect patient email at booking and explain that booking-change notices use it.

A suggested time is advisory: it does not move the appointment or reserve another slot. The patient makes a new booking, with availability checked again. The confirmation page for the original booking shows its cancelled status and rebooking guidance. Never include private receipt tokens or patient details in a general booking link.

Save cancellation, any unavailability block, suggestion, audit record, Calendar update and email job together. The background notification bot sends the email after commit, retries temporary failures and deduplicates notices for the same cancellation. Keep notification progress separate from appointment status; delivery failure does not restore the cancelled appointment. Show failed/unresolved notices to staff for follow-up. Track email-provider acceptance separately from confirmed delivery; record delivery/bounce updates when supported by the selected provider. Never mark a notice delivered solely because a job ran.

## Integrations

**Google Calendar:** Optional outbound sync to one dedicated clinic calendar. Save jobs with booking changes, then process them with retries and duplicate-event protection. Show sync failures to staff and reconcile missed updates. Booking remains confirmed during Google outages. External Google events do not block slots, and Google edits do not change bookings. Only the owner manages the connection; encrypt credentials and use minimal event details without patient contacts.

**WhatsApp:** Staff preview a minimal message, open the patient's chat and press Send. Respect messaging preferences. Opening a link does not prove sending or delivery. Automated WhatsApp bot integration is a future enhancement; the MVP cancellation bot uses email.

**Email notification bot:** Use a transactional email provider through an adapter. Send templated cancellation/rebooking emails from queued jobs; surface delivery problems to staff and retain manual WhatsApp as a follow-up option. Select the provider during implementation.

## Data protection and operations

- Collect patient name, phone, email, booking details and consent/preferences. Patient phone ownership is unverified; clinical records are outside MVP scope.
- Encrypt patient contacts and Google credentials. Keep secrets server-side and redact codes, tokens and patient data from logs.
- Use expiring, read-only confirmation links. A reference number alone cannot retrieve a booking; confirmation pages must not expose stored contact details.
- Validate input, protect mutations against forged requests, rate-limit public booking/login and prevent caching of private responses.
- Use a restricted runtime database account and a separate migration account. Tenant-based row-level security is not required for this single-clinic application.
- Review Drizzle migrations before deployment. Use managed PostgreSQL backups and verify restoration, including encryption keys.
- Select a hosting setup that supports Next.js and a reliable worker. Monitor booking errors, failed jobs and worker health.

## Dependencies and verification

Proposed tools: Next.js, React, strict TypeScript, PostgreSQL, `drizzle-orm`, `drizzle-kit`, `pg`, Better Auth, Tailwind, shadcn/ui, Zod, a timezone-aware date library and an international phone parser. Use a provider adapter for staff login emails and patient cancellation emails, and the official Google client for Calendar. Pin compatible maintained versions and a pnpm lockfile in M1.

Use Vitest for booking rules, real PostgreSQL for transactions/overlap/migrations, and Playwright for public booking and staff permissions. Include expired/reused login codes, simultaneous bookings, failed reschedules, cancellation/unavailability, suggested-slot conflicts, notification retries/duplicates/failures, Google retries and backup restoration.

## Assumptions and risks

- **Confirmed scope:** One clinic, one branch, one doctor; staff email-code login.
- **Proposed defaults:** 20-minute appointments, zero buffers, 60-minute lead time and a 30-day booking horizon; clinic timezone chosen during setup.
- **Notification choice:** Automatic cancellation emails for the MVP; collect patient email. WhatsApp bot integration is deferred. Staff login remains email-code only.
- **Before launch:** Agree on email/hosting providers, region, privacy notice, data retention, recovery and support ownership.
- **Known limits:** Unverified patient numbers can allow spam; Calendar can drift; email delivery can fail or bounce; WhatsApp delivery is manual. Use rate limits, visible sync/notification status and staff follow-up.
- **Future growth:** Adding clinics, branches or doctors will require schema migrations and revised access/scheduling rules. Keep module boundaries clear; add that infrastructure when it is needed.

See [DATABASE.md](DATABASE.md) for the essential data model and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for delivery options. Wait for explicit implementation approval.
