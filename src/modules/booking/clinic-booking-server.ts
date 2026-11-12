import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createClinicBookingAvailability } from "./clinic-booking";

export function getClinicBookingAvailability() {
  return createClinicBookingAvailability(getDatabase().db, getIdentity().access);
}
