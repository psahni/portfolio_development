# Nuvortiq Smart Booking — MVP Database

**Status:** Auth schemas, `staff_access`, `clinic_settings`, `doctor_profile` and `weekly_hours` are implemented. Appointment and integration tables remain planned.

Use **PostgreSQL**, **Drizzle ORM** and **Drizzle Kit** for one clinic, one branch and one doctor. PostgreSQL is the booking source of truth. No tenant or branch tables are needed.

## Essential tables

| Table | Purpose |
| --- | --- |
| Auth tables | Patient/staff identities, sessions and email-code verification, managed through Better Auth. Password login is disabled; standard library account fields remain unused. |
| `clinic_settings` | One clinic's name, contact details and timezone. |
| `staff_access` | Auth user, role (`admin` or `staff`), active status, protected admin PIN hash, failed attempts and lock expiry. One admin only. |
| `doctor_profile` | One doctor's name, appointment duration, buffers and booking limits. |
| Availability/exception tables | Weekly hours, holidays and special hours. |
| `appointments` | Patient account link when present, encrypted contact details, times, status, cancellation details and optional suggested time. |
| `reservations` | Appointment occupancy and manual blocks, including buffers. |
| Calendar connection/projection tables | Encrypted credentials, event IDs and sync status. |
| `outbox_jobs`, `notifications` | Saved integration work, notice status, retries and provider message IDs. |

Supporting records cover duplicate-request protection, audit history and abuse limits. Store only a server-secret-protected, salted admin PIN hash. Bootstrap creates one admin; repeated runs preserve the current PIN. PIN reset revokes that admin's sessions. Keep the already-published migration and add `0001_staff_code_access.sql` for these fields.

## Important rules

- **Patient access:** Link self-service bookings to the signed-in patient account. Staff bookings may remain unlinked; do not infer ownership from a matching name or phone. A patient session never grants admin access.
- **Staff access:** Only the doctor/admin creates staff accounts and assigns permissions. Enforce these on the server.
- **No double booking:** Lock the doctor's schedule and enforce a database overlap constraint for appointments and blocks.
- **Save together:** Commit booking/cancellation, occupancy, audit and any integration jobs in one transaction. Duplicate retries return the existing result within the retry window.
- **Cancellation:** Release appointment occupancy; block the original time if the doctor is unavailable. Queue the cancellation email and retain the optional suggestion. A suggestion is not a reservation.
- **Time:** Store appointment instants in UTC and retain booked duration/buffer snapshots. Failed reschedules preserve the original booking.

Statuses: **confirmed, cancelled, completed, no_show**. Collect patient email for automatic notices; keep clinical records out of scope. Patient accounts are separate from admin/staff access. Local test code `0000` is configuration-gated, never a stored production PIN.

Before launch, test account ownership, both login flows, permissions, concurrent bookings, notice retries and migration replay against real PostgreSQL. Agree on retention and verify backup restoration. See [ARCHITECTURE.md](ARCHITECTURE.md).
