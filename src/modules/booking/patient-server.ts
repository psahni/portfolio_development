import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createPatientAppointmentsService } from "./patient-appointments";

export function getPatientAppointmentsService() {
  return createPatientAppointmentsService(getDatabase().db, getIdentity().patientAccess);
}
