import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { patientSession, patientUser } from "@/db/schema/auth";
import { appointments, bookingAudit } from "@/db/schema/booking";
import { doctorProfile } from "@/db/schema/clinic";
import { reservations } from "@/db/schema/scheduling";
import type { PatientPrincipal } from "@/modules/identity/patient-access";
import { BookingError, patientCancellationSchema, type CancellationReceipt } from "./models";

import { isLateCancellation } from "./cancellation-policy";

type PatientAccess = { requirePatientAccess(headers: Headers): Promise<PatientPrincipal> };
const notFound = () => new BookingError(404, "APPOINTMENT_NOT_FOUND", "This appointment was not found.");

export function createPatientCancellationService(db: ApplicationDatabase, access: PatientAccess, clock = () => new Date()) {
  async function cancel(headers: Headers, input: unknown): Promise<CancellationReceipt> {
    const patient = await access.requirePatientAccess(headers);
    const { appointmentId } = patientCancellationSchema.parse(input);
    return db.transaction(async (tx) => {
      const [doctor] = await tx.select({ id: doctorProfile.id }).from(doctorProfile).where(eq(doctorProfile.id, 1)).for("update");
      if (!doctor) throw notFound();
      // Recheck inside the transaction after the shared schedule lock. Do not borrow
      // another pool connection here: other schedule writers may occupy the pool.
      const [current] = await tx.select({ id: patientSession.id }).from(patientSession)
        .innerJoin(patientUser, eq(patientUser.id, patientSession.userId))
        .where(and(eq(patientSession.id, patient.sessionId), eq(patientSession.userId, patient.userId),
          gt(patientSession.expiresAt, sql`clock_timestamp()`), eq(patientUser.emailVerified, true)));
      if (!current) throw new BookingError(401, "SIGN_IN_REQUIRED", "Sign in to cancel your appointment.");
      const [appointment] = await tx.select({ id: appointments.id, status: appointments.status,
        startsAt: appointments.startsAt, reservationId: appointments.reservationId }).from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.doctorId, 1), eq(appointments.patientUserId, patient.userId))).for("update");
      if (!appointment) throw notFound();
      const receipt: CancellationReceipt = { id: appointment.id, status: "cancelled" };
      // This also protects a new booking that has since taken the released time.
      if (appointment.status === "cancelled") return receipt;
      const now = clock();
      if (appointment.status !== "confirmed" || appointment.startsAt <= now) {
        throw new BookingError(409, "CANCELLATION_NOT_ALLOWED", "Only confirmed appointments that have not started can be cancelled. Please contact the clinic for help.");
      }
      if (!appointment.reservationId) throw new Error("Appointment occupancy is missing.");
      await tx.update(appointments).set({ status: "cancelled", reservationId: null, patientCancelledAt: now, patientCancellationLate: isLateCancellation(appointment.startsAt, now) }).where(eq(appointments.id, appointment.id));
      const released = await tx.delete(reservations).where(and(eq(reservations.id, appointment.reservationId), eq(reservations.doctorId, 1), eq(reservations.kind, "appointment"))).returning({ id: reservations.id });
      if (released.length !== 1) throw new Error("Appointment occupancy could not be released.");
      await tx.insert(bookingAudit).values({ appointmentId: appointment.id, action: "cancelled", actorKind: "patient", actorId: patient.userId, createdAt: now });
      return receipt;
    }, { isolationLevel: "read committed" });
  }
  return { cancel };
}
