import "server-only";
import { BookingError } from "./models";

type PatientAuth = {
  api: { getSession(input: { headers: Headers; query: { disableCookieCache: true; disableRefresh: true } }):
    Promise<{ session: { id: string; userId: string } } | null> };
};

export function createPatientBookingAccess(patientAuth: PatientAuth) {
  return async (headers: Headers) => {
    const authenticated = await patientAuth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (!authenticated) throw new BookingError(401, "SIGN_IN_REQUIRED", "Sign in to book an appointment.");
    return { userId: authenticated.session.userId, sessionId: authenticated.session.id };
  };
}
