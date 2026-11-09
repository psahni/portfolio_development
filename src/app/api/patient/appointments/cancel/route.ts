import { createPatientCancellationHandler } from "@/modules/booking/patient-cancellation-http";
import { getPatientCancellationService } from "@/modules/booking/patient-server";
import { readAuthEnvironment } from "@/platform/env";

export const POST = createPatientCancellationHandler(getPatientCancellationService, () => readAuthEnvironment().APP_URL);
