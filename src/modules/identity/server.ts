import "server-only";
import { createDatabase } from "@/db/connection";
import { readAuthEnvironment } from "@/platform/env";
import { unconfiguredMailer } from "@/platform/mail";
import { createIdentity } from "./create-auth";

let identity: ReturnType<typeof createIdentity> | undefined;

// Lazy initialization: importing a page must not open database connections at build time.
export function getIdentity() {
  if (!identity) {
    const env = readAuthEnvironment();
    const { db } = createDatabase(env.DATABASE_URL);
    identity = createIdentity({ db, baseURL: env.APP_URL, patientSecret: env.PATIENT_AUTH_SECRET, staffSecret: env.STAFF_AUTH_SECRET, mailer: unconfiguredMailer });
  }
  return identity;
}
