import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createPatientBookingAccess } from "./access";
import { createContactProtection } from "./contact-protection";
import { createBookingService } from "./service";

export function getBookingService() {
  const identity = getIdentity();
  return createBookingService(getDatabase().db, {
    ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient),
  }, createContactProtection(process.env.BOOKING_DATA_KEY));
}
