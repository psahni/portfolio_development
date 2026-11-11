import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createWhatsAppConsentHandler } from "@/modules/notifications/consent";
import { readAuthEnvironment } from "@/platform/env";

export async function POST(request: Request) {
  return createWhatsAppConsentHandler(getDatabase().db, getIdentity().patientAccess, () => readAuthEnvironment().APP_URL)(request);
}
