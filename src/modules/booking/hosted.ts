import "server-only";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import type { ApplicationDatabase } from "@/db/connection";
import { patientUser } from "@/db/schema/auth";
import type { PatientPrincipal } from "@/modules/identity/patient-access";
import { createSlotAvailabilityService } from "@/modules/scheduling/slots";

export function createHostedBookingService(db: ApplicationDatabase, access: { requirePatientAccess(headers: Headers): Promise<PatientPrincipal> }, clock = () => new Date()) {
  const slots = createSlotAvailabilityService(db, clock);
  async function view(headers: Headers, date?: string) {
    const principal = await access.requirePatientAccess(headers);
    const [patient] = await db.select({ email: patientUser.email, verified: patientUser.emailVerified }).from(patientUser).where(eq(patientUser.id, principal.userId));
    if (!patient?.verified) throw new APIError("UNAUTHORIZED", { message: "Sign in to book an appointment." });
    return { email: patient.email, availability: await slots.read(date) };
  }
  return { view };
}
