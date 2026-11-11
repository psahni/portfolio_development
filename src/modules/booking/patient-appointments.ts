import "server-only";
import { asc, eq } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import type { ApplicationDatabase } from "@/db/connection";
import { appointments } from "@/db/schema/booking";
import type { PatientPrincipal } from "@/modules/identity/patient-access";

type PatientAccess = { requirePatientAccess(headers: Headers): Promise<PatientPrincipal> };
export type PatientAppointment = {
  id: string; startsAt: string; endsAt: string; timezone: string;
  patientCancellationLate: boolean | null;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
};

export function createPatientAppointmentsService(db: ApplicationDatabase, access: PatientAccess, clock = () => new Date()) {
  async function list(headers: Headers): Promise<PatientAppointment[]> {
    const patient = await access.requirePatientAccess(headers);
    // Ownership comes only from the patient session. Contact matches never grant access.
    const rows = await db.select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt,
      timezone: appointments.timezone, status: appointments.status, patientCancellationLate: appointments.patientCancellationLate }).from(appointments)
      .where(eq(appointments.patientUserId, patient.userId)).orderBy(asc(appointments.startsAt), asc(appointments.id));
    return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
  }
  async function view(headers: Headers) {
    const appointments = await list(headers), now = clock().getTime();
    const isUpcoming = (appointment: PatientAppointment) => appointment.status === "confirmed" && Date.parse(appointment.endsAt) > now;
    return { total: appointments.length, upcoming: appointments.filter(isUpcoming).map((appointment) => ({ ...appointment, canCancel: Date.parse(appointment.startsAt) > now })), history: appointments.filter((appointment) => !isUpcoming(appointment)).reverse() };
  }
  return { list, view };
}

export function createPatientAppointmentsHandler(getService: () => ReturnType<typeof createPatientAppointmentsService>) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    if (request.method !== "GET") return respond({ error: "Method not allowed." }, 405);
    try { return respond({ appointments: await getService().list(request.headers) }); }
    catch (error) {
      if (isAPIError(error) && error.status === "UNAUTHORIZED") return respond({ error: "Sign in to view your appointments." }, 401);
      return respond({ error: "Your appointments are temporarily unavailable. Please try again." }, 503);
    }
  };
}
