import { createPatientAuthHandler } from "@/modules/identity/patient-http";
import { getIdentity } from "@/modules/identity/server";
import { readAuthEnvironment } from "@/platform/env";

// Real email delivery is not connected yet. Do not claim a code was sent in normal mode.
const handle = createPatientAuthHandler(() => getIdentity().patient, () => getIdentity().patient.options.baseURL, () => readAuthEnvironment().AUTH_TEST_MODE);
export const POST = handle;
export const GET = handle;
