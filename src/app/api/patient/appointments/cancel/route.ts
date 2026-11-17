import { createPatientCancellationHandler } from "@/modules/booking/patient-cancellation-http";
import { getPatientCancellationService } from "@/modules/booking/patient-server";
import { readAuthEnvironment } from "@/platform/env";
import { createPostCancellationWhatsApp } from "@/modules/notifications/post-cancellation";
import { getDatabase } from "@/db/server";

export const POST = createPatientCancellationHandler(getPatientCancellationService, () => readAuthEnvironment().APP_URL, createPostCancellationWhatsApp(() => getDatabase().db));
