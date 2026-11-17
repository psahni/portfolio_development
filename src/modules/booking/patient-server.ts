import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createPatientAppointmentsService } from "./patient-appointments";
import { createPatientCancellationService } from "./patient-cancellation";
import { whatsappCancellationEvents } from "@/modules/notifications/cancellation-events";

export function getPatientAppointmentsService() {
  return createPatientAppointmentsService(getDatabase().db, getIdentity().patientAccess);
}

export function getPatientCancellationService() {
  return createPatientCancellationService(getDatabase().db, getIdentity().patientAccess, undefined, whatsappCancellationEvents);
}
