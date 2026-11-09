import "server-only";
import { APIError } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { patientSession, patientUser } from "@/db/schema/auth";

type PatientAuth = {
  api: { getSession(input: { headers: Headers; query: { disableCookieCache: true; disableRefresh: true } }):
    Promise<{ session: { id: string; userId: string; token: string } } | null> };
};
export type PatientPrincipal = { userId: string; sessionId: string };

export function createPatientAccessChecks(db: ApplicationDatabase, patientAuth: PatientAuth) {
  async function requirePatientAccess(headers: Headers): Promise<PatientPrincipal> {
    const authenticated = await patientAuth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (authenticated) {
      const { session } = authenticated;
      const [current] = await db.select({ id: patientSession.id }).from(patientSession)
        .innerJoin(patientUser, eq(patientUser.id, patientSession.userId))
        .where(and(eq(patientSession.id, session.id), eq(patientSession.userId, session.userId),
          eq(patientSession.token, session.token), gt(patientSession.expiresAt, sql`clock_timestamp()`), eq(patientUser.emailVerified, true)));
      if (current) return { userId: session.userId, sessionId: session.id };
    }
    throw new APIError("UNAUTHORIZED", { message: "Sign in to view your appointments." });
  }
  return { requirePatientAccess };
}
