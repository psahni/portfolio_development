import "server-only";
import type { BookingEvents } from "@/modules/booking/events";
import { whatsappConsents, whatsappNotifications } from "@/db/schema/notifications";

export const whatsappBookingEvents: BookingEvents = {
  async created(tx, event) {
    await tx.insert(whatsappConsents).values({ appointmentId: event.appointmentId, consented: event.whatsappConsent, recordedAt: event.at });
    // The conversational path sends its booking receipt in the same chat after commit;
    // never route that consent to Phase 1's fixed test recipient.
    if (event.whatsappConsent && event.channel !== "whatsapp") await tx.insert(whatsappNotifications).values({ appointmentId: event.appointmentId, availableAt: event.at, updatedAt: event.at });
  },
};
