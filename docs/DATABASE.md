# Nuvortiq Smart Booking — MVP Database

**Status:** Auth, clinic settings, availability and shared booking persistence are implemented. Integration tables remain planned.

Use **PostgreSQL**, **Drizzle ORM** and **Drizzle Kit** for one clinic, one branch and one doctor. PostgreSQL is the booking source of truth. No tenant or branch tables are needed.

## Essential tables

| Table | Purpose |
| --- | --- |
| Auth tables | Patient/staff identities, sessions and email-code verification, managed through Better Auth. Password login is disabled; standard library account fields remain unused. |
| `clinic_settings` | One clinic's name, contact details and timezone. |
| `staff_access` | Auth user, role (`admin` or `staff`), active status, protected admin PIN hash, failed attempts and lock expiry. One admin only. |
| `doctor_profile` | One doctor's name, appointment duration, buffers and booking limits. |
| `weekly_hours`, `day_overrides` | Normal weekly hours; a clinic-local date's holiday or replacement special hours. |
| `appointments` | Explicit patient link or staff creator, encrypted contacts, UTC times and booked timezone/duration/buffer snapshots. Cancellation retains history and clears the reservation link. Doctor cancellation also saves the staff actor/time, short nonclinical reason, rebooking instruction and whether original time was blocked. |
| `booking_audit`, `booking_requests` | Creation/cancellation audit and actor-scoped confirmation receipts for safe retries within 24 hours; expired keys cannot be reused. |
| `reservations` | UTC occupancy with PostgreSQL non-overlap protection. Manual breaks and confirmed appointment occupancy, including buffers. |
| Calendar connection/projection tables | Encrypted credentials, event IDs and sync status. |
| `outbox_jobs`, `notifications` | Saved integration work, notice status, retries and provider message IDs. |

Migration `0004_shared_booking.sql` adds booking records and preserves the existing occupancy exclusion constraint. `0005_patient_cancellation.sql` permits cancellation audit events without changing existing data or occupancy constraints. Contacts use AES-256-GCM with a dedicated `BOOKING_DATA_KEY`; retain the key securely for restoration. Admin PINs remain salted, protected hashes; repeated bootstrap preserves the current PIN.

`0006_doctor_cancellation.sql` adds nullable doctor cancellation metadata and a consistency constraint, preserving existing patient cancellations and confirmation receipts. Reasons/instructions are short nonclinical text for authorized admin use, not medical records. Blocking converts only the cancelled appointment's detached reservation to a manual block with its original UTC buffers. The saved block flag records the cancellation decision; later removal through Availability does not recreate a block on retry.

## Important rules

- **Patient access:** Link self-service bookings to the signed-in patient account. Staff bookings may remain unlinked; do not infer ownership from a matching name or phone. A patient session never grants admin access.
- **Staff access:** Only the doctor/admin creates staff accounts and assigns permissions. Enforce these on the server.
- **No double booking:** Lock the doctor's schedule and enforce a database overlap constraint for appointments and blocks.
- **Save together:** Commit booking/cancellation, occupancy, audit and any integration jobs in one transaction. Duplicate retries return the existing result within the retry window.
- **Cancellation:** Release appointment occupancy; block the original time if the doctor is unavailable. Queue the cancellation email and retain the optional suggestion. A suggestion is not a reservation.
- **Time:** Store appointment instants in UTC and retain booked duration/buffer snapshots. Failed reschedules preserve the original booking.

Statuses: **confirmed, cancelled, completed, no_show**. Collect patient email for automatic notices; keep clinical records out of scope. Patient accounts are separate from admin/staff access. Local test code `0000` is configuration-gated, never a stored production PIN.

Before launch, test account ownership, both login flows, permissions, concurrent bookings, notice retries and migration replay against real PostgreSQL. Agree on retention and verify backup restoration. See [ARCHITECTURE.md](ARCHITECTURE.md).

Migration `0007` adds nullable patient cancellation timestamp/late classification, saved atomically with release and audit. Less than two hours is late; exactly two hours is on time. Existing history is not backfilled. A consistency constraint enforces paired values, patient ownership, cancelled status and the two-hour boundary; the occupancy exclusion constraint is unchanged.

Migration `0008_whatsapp_phase_one.sql` adds separate `whatsapp_consents`, `whatsapp_notifications` and `whatsapp_attempts` tables. Consent retains the server recording time and withdrawal status/time. One unique appointment/event job joins the creation transaction; attempts contain safe codes and API message IDs, never access tokens or raw provider bodies. Existing bookings are not backfilled. The GiST occupancy constraint is unchanged.

Migration `0009_local_booking_email.sql` adds `local_booking_emails`: one local simulation job per appointment, a clinic/template snapshot without patient contacts and a nullable log-completion timestamp. The job joins the booking transaction only when local simulation is explicitly enabled for clinic-created bookings. It does not change existing tables or the GiST exclusion constraint.
