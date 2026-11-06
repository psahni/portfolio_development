# Nuvortiq Smart Booking — MVP Database

**Status: proposed; awaiting review. No database changes have been made.**

Use **PostgreSQL**, **Drizzle ORM** for queries and **Drizzle Kit** for migrations. The MVP serves **one clinic, one branch and one doctor**. No tenant or branch tables are needed.

## Essential tables

| Table | What it stores |
| --- | --- |
| `clinic_settings` | One settings record: clinic name, address, contact details and timezone. |
| `staff_access` | Approved staff account, role (owner/receptionist) and active status. |
| `doctor_profile` | One doctor record: name, appointment duration, buffers and booking limits. |
| `availability_windows` | Weekly working days and hours. |
| `schedule_exceptions`, `exception_windows` | Holidays and special working hours for specific dates. |
| `appointments` | Doctor, patient name/phone/email, start/end time, source, consent and status; cancellation reason, cancelled-by/time and optional suggested start time. |
| `reservations` | Occupied time, including appointment buffers and manually blocked slots. |
| `google_connections`, `calendar_projections` | Encrypted Google credentials, target calendar, appointment event IDs and sync status. |
| `outbox_jobs` | Calendar updates and automatic cancellation emails waiting to run or retry. |
| `notifications` | Appointment, cancellation event, email status, attempt count and provider message ID for follow-up. |

Better Auth manages staff accounts, sessions and one-time login-code verification. Staff sign in using a code sent to email only; no password or two-factor authentication is required.

The owner adds approved staff emails. Supporting records handle invitations, expiring confirmation links, duplicate-request protection, audit history, OAuth verification and booking rate limits.

## Important rules

- **Staff access:** Only active, approved staff can access patient records. Only the owner manages settings and staff permissions.
- **Single clinic:** Keep one clinic settings record and one doctor profile. No `tenant_id` or tenant-based row-level security is needed.
- **No double booking:** Use a database overlap constraint covering appointments and manual blocks. Lock the doctor's schedule while validating changes.
- **Save together:** Save the appointment, reservation, audit record and any Calendar/notification jobs in one transaction. Confirm only after it succeeds.
- **Safe changes:** Duplicate retries return the existing booking within the retry window. Cancellation releases the booking; if the doctor is unavailable, save a manual block for that time in the same transaction. A failed reschedule preserves the original booking.
- **Time handling:** Store appointment times in UTC and working hours in the clinic's timezone. Keep booked duration and buffer values unchanged when settings change.

Appointment statuses: **confirmed, cancelled, completed, no_show**.

## Patient data and integrations

- Store encrypted patient name, phone and email on each appointment. Require patient email at booking for automatic notices. No separate patient registry or medical records in the MVP.
- Confirmation links are expiring and read-only. A booking reference alone cannot retrieve patient information.
- Run Google sync after booking is saved; retry failures without losing the booking.
- Cancellation notices include a suggested time or rebooking link. Suggestions do not reserve slots; check availability on rebooking.
- The notification bot automatically emails cancellation notices, retries failures and prevents duplicate notices for the same cancellation. Track provider acceptance separately from confirmed delivery. WhatsApp links remain manual; a WhatsApp bot is deferred.

## Before launch

Review Drizzle migrations; test staff permissions, simultaneous bookings and rescheduling against real PostgreSQL. Verify backups can be restored and agree on patient-data retention.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the broader security design and assumptions.
