import { createPostBookingWhatsApp } from "@/modules/notifications/post-booking";
import { createPatientBookingHandler } from "@/modules/booking/hosted-http";
import { getBookingService } from "@/modules/booking/server";
import { getDatabase } from "@/db/server";
import { readAuthEnvironment } from "@/platform/env";

export const POST = createPatientBookingHandler(getBookingService, () => readAuthEnvironment().APP_URL, createPostBookingWhatsApp(() => getDatabase().db));
