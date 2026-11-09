import { createPatientAppointmentsHandler } from "@/modules/booking/patient-appointments";
import { getPatientAppointmentsService } from "@/modules/booking/patient-server";

export const GET = createPatientAppointmentsHandler(getPatientAppointmentsService);
