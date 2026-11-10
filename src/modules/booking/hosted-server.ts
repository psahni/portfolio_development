import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createHostedBookingService } from "./hosted";

export function getHostedBookingService() {
  return createHostedBookingService(getDatabase().db, getIdentity().patientAccess);
}
