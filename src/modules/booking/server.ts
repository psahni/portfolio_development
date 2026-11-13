import "server-only";
import { localBookingEmailEnabled, localEmailBookingEvents } from "@/modules/notifications/local-booking-email";
import { whatsappBookingEvents } from "@/modules/notifications/booking-events";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createPatientBookingAccess } from "./access";
import { createContactProtection } from "./contact-protection";
import { createBookingService } from "./service";

export function getBookingService() {
  const identity = getIdentity();
  const emailEvents = localEmailBookingEvents(localBookingEmailEnabled());
  return createBookingService(getDatabase().db, {
    ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient),
  }, createContactProtection(process.env.BOOKING_DATA_KEY), undefined, { async created(tx, event) {
    await whatsappBookingEvents.created?.(tx, event);
    await emailEvents.created?.(tx, event);
  } });
}
