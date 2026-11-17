import "server-only";
import { and, eq } from "drizzle-orm";
import type { BookingCancellationEvents } from "@/modules/booking/events";
import { appointments } from "@/db/schema/booking";
import { whatsappConsents, whatsappNotifications } from "@/db/schema/notifications";

export const whatsappCancellationEvents: BookingCancellationEvents = {
  async cancelled(tx, event) {
    const [appointment] = await tx.select({ verified: appointments.whatsappNumberVerified, patientUserId: appointments.patientUserId }).from(appointments)
      .where(and(eq(appointments.id, event.appointmentId), event.patientUserId ? eq(appointments.patientUserId, event.patientUserId) : undefined));
    const [consent] = await tx.select().from(whatsappConsents).where(and(eq(whatsappConsents.appointmentId, event.appointmentId), eq(whatsappConsents.consented, true), eq(whatsappConsents.withdrawn, false)));
    if (!appointment?.verified || !appointment.patientUserId || !consent) return;
    await tx.insert(whatsappNotifications).values({ appointmentId: event.appointmentId, event: "appointment_cancelled", availableAt: event.at, updatedAt: event.at });
  },
};
