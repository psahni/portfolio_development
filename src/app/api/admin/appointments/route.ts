import { createDoctorAppointmentsHandler } from "@/modules/booking/doctor-http";
import { getDoctorAppointmentsService } from "@/modules/booking/doctor-server";
import { readAuthEnvironment } from "@/platform/env";
import { createPostCancellationWhatsApp } from "@/modules/notifications/post-cancellation";
import { getDatabase } from "@/db/server";

export const dynamic = "force-dynamic";
const handler = createDoctorAppointmentsHandler(getDoctorAppointmentsService, () => readAuthEnvironment().APP_URL, createPostCancellationWhatsApp(() => getDatabase().db));
export const GET = handler;
export const POST = handler;
