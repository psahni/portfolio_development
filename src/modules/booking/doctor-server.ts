import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createContactProtection } from "./contact-protection";
import { createDoctorAppointmentsService } from "./doctor-appointments";
import { whatsappCancellationEvents } from "@/modules/notifications/cancellation-events";

export function getDoctorAppointmentsService() {
  return createDoctorAppointmentsService(getDatabase().db, getIdentity().access, () => createContactProtection(process.env.BOOKING_DATA_KEY), undefined, whatsappCancellationEvents);
}
