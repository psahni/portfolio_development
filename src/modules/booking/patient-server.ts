import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createPatientAppointmentsService } from "./patient-appointments";
import { createPatientCancellationService } from "./patient-cancellation";

export function getPatientAppointmentsService() {
  return createPatientAppointmentsService(getDatabase().db, getIdentity().patientAccess);
}

export function getPatientCancellationService() {
  return createPatientCancellationService(getDatabase().db, getIdentity().patientAccess);
}
