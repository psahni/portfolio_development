import { createDoctorAppointmentsHandler } from "@/modules/booking/doctor-http";
import { getDoctorAppointmentsService } from "@/modules/booking/doctor-server";
import { readAuthEnvironment } from "@/platform/env";

export const dynamic = "force-dynamic";
const handler = createDoctorAppointmentsHandler(getDoctorAppointmentsService, () => readAuthEnvironment().APP_URL);
export const GET = handler;
export const POST = handler;
