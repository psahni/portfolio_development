import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { APIError, isAPIError } from "better-auth/api";
import { z } from "zod";
import type { ApplicationDatabase } from "@/db/connection";
import { patientSession, patientUser } from "@/db/schema/auth";
import { appointments } from "@/db/schema/booking";
import { whatsappConsents, whatsappNotifications } from "@/db/schema/notifications";
import type { PatientPrincipal } from "@/modules/identity/patient-access";

type Access = { requirePatientAccess(headers: Headers): Promise<PatientPrincipal> };
const withdrawal = z.object({ appointmentId: z.uuid() }).strict();
export function createWhatsAppConsentHandler(db: ApplicationDatabase, access: Access, trustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
    if (request.headers.get("origin") !== new URL(trustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
    try {
      const patient = await access.requirePatientAccess(request.headers);
      const { appointmentId } = withdrawal.parse(await request.json());
      const found = await db.transaction(async (tx) => {
        // Serialize with job claims: a completed withdrawal suppresses pending work.
        const [job] = await tx.select().from(whatsappNotifications).where(eq(whatsappNotifications.appointmentId, appointmentId)).for("update");
        const [appointment] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.patientUserId, patient.userId)));
        if (!appointment) return false;
        // Session may have been revoked while waiting for the notification lock.
        const [current] = await tx.select({ id: patientSession.id }).from(patientSession)
          .innerJoin(patientUser, eq(patientUser.id, patientSession.userId))
          .where(and(eq(patientSession.id, patient.sessionId), eq(patientSession.userId, patient.userId), gt(patientSession.expiresAt, sql`clock_timestamp()`), eq(patientUser.emailVerified, true)));
        if (!current) throw new APIError("UNAUTHORIZED", { message: "Sign in again." });
        const now = new Date();
        await tx.update(whatsappConsents).set({ withdrawn: true, withdrawnAt: now }).where(and(eq(whatsappConsents.appointmentId, appointmentId), eq(whatsappConsents.consented, true), eq(whatsappConsents.withdrawn, false)));
        if (job?.status === "pending") await tx.update(whatsappNotifications).set({ status: "suppressed", updatedAt: now, errorCode: "CONSENT_WITHDRAWN" }).where(eq(whatsappNotifications.id, job.id));
        return true;
      });
      return found ? respond({ withdrawn: true }) : respond({ error: "Appointment not found." }, 404);
    } catch (error) {
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) return respond({ error: "Sign in again to manage WhatsApp consent." }, error.statusCode);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
      return respond({ error: "WhatsApp consent could not be updated. Please retry." }, 503);
    }
  };
}
