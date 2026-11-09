import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { patientSession, patientUser, staffAccess, staffSession } from "@/db/schema/auth";
import { appointments, bookingAudit, bookingRequests } from "@/db/schema/booking";
import { doctorProfile } from "@/db/schema/clinic";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { clinicDate, dayBounds, generateSlots } from "@/modules/scheduling/engine";
import type { ContactProtection } from "./contact-protection";
import { BookingError, clinicBookingSchema, patientBookingSchema, type BookingActor, type BookingReceipt, type PatientContact } from "./models";

type Transaction = Parameters<Parameters<ApplicationDatabase["transaction"]>[0]>[0];
type BookingAccess = {
  requireClinicAccess(headers: Headers): Promise<ClinicPrincipal>;
  requirePatientAccess(headers: Headers): Promise<{ userId: string; sessionId: string }>;
};
type BookingInput = { requestId: string; startsAt: string; name: string; phone: string; email?: string };
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function assertActorActive(tx: Transaction, actor: BookingActor): Promise<string | undefined> {
  // Verify again after acquiring the schedule lock: queued requests may outlive a session
  // or staff deactivation. Use the database clock, not a client-supplied role or timestamp.
  if (actor.kind === "staff") {
    const [current] = await tx.select({ role: staffAccess.role }).from(staffSession)
      .innerJoin(staffAccess, eq(staffAccess.userId, staffSession.userId))
      .where(and(eq(staffSession.id, actor.sessionId), eq(staffSession.userId, actor.userId),
        gt(staffSession.expiresAt, sql`clock_timestamp()`), eq(staffAccess.active, true)));
    if (!current || !["admin", "staff"].includes(current.role)) throw new BookingError(403, "ACCESS_DENIED", "Clinic booking access is not permitted.");
    return;
  }
  const [current] = await tx.select({ email: patientUser.email }).from(patientSession)
    .innerJoin(patientUser, eq(patientUser.id, patientSession.userId))
    .where(and(eq(patientSession.id, actor.sessionId), eq(patientSession.userId, actor.userId),
      gt(patientSession.expiresAt, sql`clock_timestamp()`), eq(patientUser.emailVerified, true)));
  if (!current) throw new BookingError(401, "SIGN_IN_REQUIRED", "Sign in with a verified email to book an appointment.");
  return current.email;
}

function isOverlapError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "23P01") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export function createBookingService(db: ApplicationDatabase, access: BookingAccess, protection: ContactProtection, clock = () => new Date()) {
  async function save(actor: BookingActor, input: BookingInput): Promise<BookingReceipt> {
    try {
      // Returning this promise waits for COMMIT. No provider calls or user confirmation
      // happen inside the transaction, and no partial reservation survives a failure.
      return await db.transaction(async (tx) => {
        const [doctor] = await tx.select({ id: doctorProfile.id }).from(doctorProfile).where(eq(doctorProfile.id, 1)).for("update");
        if (!doctor) throw new BookingError(409, "CLINIC_NOT_READY", "Clinic settings must be saved before booking.");
        const verifiedEmail = await assertActorActive(tx, actor), now = clock();
        const contact: PatientContact = { name: input.name, phone: input.phone, email: verifiedEmail ?? input.email! };
        const fingerprint = protection.fingerprint(JSON.stringify({ startsAt: input.startsAt, ...contact }));
        const requestScope = and(eq(bookingRequests.actorKind, actor.kind), eq(bookingRequests.actorId, actor.userId), eq(bookingRequests.requestId, input.requestId));
        const [previous] = await tx.select().from(bookingRequests).where(requestScope);
        if (previous) {
          if (previous.fingerprint !== fingerprint || previous.expiresAt <= now) {
            throw new BookingError(409, "REQUEST_KEY_CONFLICT", "This booking request key is expired or was used for different details. Start a new booking request.");
          }
          return previous.receipt;
        }

        const config = (await readClinicConfiguration(tx))!;
        const date = clinicDate(new Date(input.startsAt), config.timezone), bounds = dayBounds(date, config.timezone);
        const [override] = await tx.select().from(dayOverrides).where(and(eq(dayOverrides.doctorId, 1), eq(dayOverrides.date, date)));
        const occupied = await tx.select().from(reservations).where(and(eq(reservations.doctorId, 1), lt(reservations.startsAt, bounds.end), gt(reservations.endsAt, bounds.start)));
        const slot = generateSlots(config, date, override ?? null, occupied, now).find((candidate) => candidate.startsAt === input.startsAt);
        if (!slot) throw new BookingError(409, "SLOT_UNAVAILABLE", "That slot is no longer available. Refresh the available times and choose another slot.");

        const id = randomUUID();
        const receipt: BookingReceipt = { id, status: "confirmed", startsAt: slot.startsAt, endsAt: slot.endsAt, timezone: config.timezone,
          durationMinutes: config.durationMinutes, bufferBeforeMinutes: config.bufferBeforeMinutes, bufferAfterMinutes: config.bufferAfterMinutes };
        const [reservation] = await tx.insert(reservations).values({ doctorId: 1, kind: "appointment", startsAt: new Date(slot.occupiedStart), endsAt: new Date(slot.occupiedEnd) }).returning({ id: reservations.id });
        await tx.insert(appointments).values({ id, doctorId: 1, reservationId: reservation.id,
          patientUserId: actor.kind === "patient" ? actor.userId : null, createdByStaffId: actor.kind === "staff" ? actor.userId : null,
          source: actor.kind === "patient" ? "patient" : "clinic", contactCiphertext: protection.encrypt(id, contact),
          startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), timezone: config.timezone,
          durationMinutes: config.durationMinutes, bufferBeforeMinutes: config.bufferBeforeMinutes, bufferAfterMinutes: config.bufferAfterMinutes, createdAt: now });
        await tx.insert(bookingAudit).values({ appointmentId: id, actorKind: actor.kind, actorId: actor.userId, createdAt: now });
        await tx.insert(bookingRequests).values({ actorKind: actor.kind, actorId: actor.userId, requestId: input.requestId,
          fingerprint, appointmentId: id, receipt, createdAt: now, expiresAt: new Date(now.getTime() + RETRY_WINDOW_MS) });
        return receipt;
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (isOverlapError(error)) throw new BookingError(409, "SLOT_UNAVAILABLE", "That slot was just taken. Refresh the available times and choose another slot.");
      throw error;
    }
  }

  async function bookPatient(headers: Headers, input: unknown) {
    const principal = await access.requirePatientAccess(headers);
    return save({ kind: "patient", ...principal }, patientBookingSchema.parse(input));
  }
  async function bookForClinic(headers: Headers, input: unknown) {
    const principal = await access.requireClinicAccess(headers);
    return save({ kind: "staff", userId: principal.userId, sessionId: principal.sessionId }, clinicBookingSchema.parse(input));
  }
  return { bookPatient, bookForClinic };
}
