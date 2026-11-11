import "server-only";
import { and, asc, eq, gte, gt, lt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { staffAccess, staffSession } from "@/db/schema/auth";
import { appointments, bookingAudit } from "@/db/schema/booking";
import { doctorProfile } from "@/db/schema/clinic";
import { reservations } from "@/db/schema/scheduling";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { clinicDate, dayBounds } from "@/modules/scheduling/engine";
import type { ContactProtection } from "./contact-protection";
import { doctorCancellationSchema, doctorDateSchema, type DoctorAppointmentsView } from "./doctor-models";
import { BookingError, type CancellationReceipt } from "./models";

type AdminAccess = { requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> };

export function createDoctorAppointmentsService(db: ApplicationDatabase, access: AdminAccess, getProtection: () => ContactProtection, clock = () => new Date()) {
  async function view(headers: Headers, selectedDate?: string): Promise<DoctorAppointmentsView> {
    await access.requireAdminAccess(headers);
    const requested = doctorDateSchema.parse(selectedDate);
    return db.transaction(async (tx) => {
      const config = await readClinicConfiguration(tx);
      if (!config) return { configured: false, date: requested ?? "", timezone: "", appointments: [] };
      const now = clock(), date = requested ?? clinicDate(now, config.timezone), bounds = dayBounds(date, config.timezone);
      const rows = await tx.select().from(appointments).where(and(eq(appointments.doctorId, 1),
        gte(appointments.startsAt, bounds.start), lt(appointments.startsAt, bounds.end))).orderBy(asc(appointments.startsAt), asc(appointments.id));
      // Initialize the key only after authorization and only when contacts need reading.
      const protection = rows.length ? getProtection() : null;
      return { configured: true, date, timezone: config.timezone, appointments: rows.map((row) => ({
        id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), bookedTimezone: row.timezone,
        status: row.status, contact: protection!.decrypt(row.id, row.contactCiphertext),
        canCancel: row.status === "confirmed" && row.startsAt > now,
        cancellation: row.cancelledByStaffId ? { reason: row.cancellationReason!, rebookingInstruction: row.rebookingInstruction!,
          originalTimeBlocked: row.originalTimeBlocked, cancelledAt: row.cancelledAt!.toISOString() } : null,
      })) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function cancel(headers: Headers, input: unknown): Promise<CancellationReceipt> {
    const principal = await access.requireAdminAccess(headers);
    const value = doctorCancellationSchema.parse(input);
    return db.transaction(async (tx) => {
      const [doctor] = await tx.select({ id: doctorProfile.id }).from(doctorProfile).where(eq(doctorProfile.id, 1)).for("update");
      if (!doctor) throw new BookingError(404, "APPOINTMENT_NOT_FOUND", "This appointment was not found.");
      // Recheck using this transaction connection after waiting for the shared lock.
      const [current] = await tx.select({ id: staffSession.id }).from(staffSession)
        .innerJoin(staffAccess, eq(staffAccess.userId, staffSession.userId))
        .where(and(eq(staffSession.id, principal.sessionId), eq(staffSession.userId, principal.userId),
          gt(staffSession.expiresAt, sql`clock_timestamp()`), eq(staffAccess.active, true), eq(staffAccess.role, "admin")));
      if (!current) throw new BookingError(403, "ACCESS_DENIED", "Active admin access is required. Sign in again.");
      const [appointment] = await tx.select().from(appointments)
        .where(and(eq(appointments.id, value.appointmentId), eq(appointments.doctorId, 1))).for("update");
      if (!appointment) throw new BookingError(404, "APPOINTMENT_NOT_FOUND", "This appointment was not found.");
      const receipt: CancellationReceipt = { id: appointment.id, status: "cancelled" };
      if (appointment.status === "cancelled") {
        if (appointment.cancelledByStaffId === principal.userId && appointment.cancellationReason === value.reason &&
          appointment.rebookingInstruction === value.rebookingInstruction && appointment.originalTimeBlocked === value.blockOriginalTime) return receipt;
        throw new BookingError(409, "CANCELLATION_CONFLICT", "This appointment was already cancelled with different details. Refresh appointments.");
      }
      const now = clock();
      if (appointment.status !== "confirmed" || appointment.startsAt <= now) {
        throw new BookingError(409, "CANCELLATION_NOT_ALLOWED", "Only confirmed appointments that have not started can be cancelled.");
      }
      if (!appointment.reservationId) throw new Error("Appointment occupancy is missing.");
      await tx.update(appointments).set({ status: "cancelled", reservationId: null, cancelledByStaffId: principal.userId,
        cancelledAt: now, cancellationReason: value.reason, rebookingInstruction: value.rebookingInstruction,
        originalTimeBlocked: value.blockOriginalTime }).where(eq(appointments.id, appointment.id));
      const scope = and(eq(reservations.id, appointment.reservationId), eq(reservations.doctorId, 1), eq(reservations.kind, "appointment"));
      // Converting the detached reservation preserves the exact booked buffers,
      // even if clinic settings changed. No other appointment or break is touched.
      const changed = value.blockOriginalTime
        ? await tx.update(reservations).set({ kind: "block", reason: "Doctor unavailable" }).where(scope).returning({ id: reservations.id })
        : await tx.delete(reservations).where(scope).returning({ id: reservations.id });
      if (changed.length !== 1) throw new Error("Appointment occupancy could not be changed.");
      await tx.insert(bookingAudit).values({ appointmentId: appointment.id, action: "cancelled", actorKind: "staff", actorId: principal.userId, createdAt: now });
      return receipt;
    }, { isolationLevel: "read committed" });
  }
  return { view, cancel };
}
