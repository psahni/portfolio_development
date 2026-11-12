import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import { SchedulingError } from "@/modules/scheduling/models";
import type { createHostedBookingService } from "./hosted";
import type { createBookingService } from "./service";
import type { BookingReceipt } from "./models";
import { BookingError } from "./models";

const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
function failure(error: unknown) {
  if (isAPIError(error) && error.status === "UNAUTHORIZED") return respond({ code: "SIGN_IN_REQUIRED", error: "Sign in to book an appointment." }, 401);
  if (error instanceof BookingError) return respond({ code: error.code, error: error.message }, error.statusCode);
  if (error instanceof SchedulingError) return respond({ error: error.message }, error.statusCode);
  if (error instanceof ZodError || error instanceof SyntaxError) return respond({ error: "Check the date, selected time, name and phone number." }, 400);
  return respond({ error: "Booking is temporarily unavailable. Please try again." }, 503);
}

export function createHostedAvailabilityHandler(getService: () => ReturnType<typeof createHostedBookingService>) {
  return async (request: Request) => {
    if (request.method !== "GET") return respond({ error: "Method not allowed." }, 405);
    try { return respond(await getService().view(request.headers, new URL(request.url).searchParams.get("date") ?? undefined)); }
    catch (error) { return failure(error); }
  };
}

export function createPatientBookingHandler(getService: () => ReturnType<typeof createBookingService>, getTrustedOrigin: () => string, afterConfirmation: (receipt: BookingReceipt) => Promise<void> = async () => {}) {
  return async (request: Request) => {
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
    try {
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const input: unknown = await request.json();
      let service: ReturnType<typeof createBookingService>;
      try { service = getService(); }
      catch {
        // Initialization failed before the booking service could start a transaction.
        return respond({ code: "BOOKING_NOT_READY", error: "Online booking is temporarily unavailable. Please try again or contact the clinic." }, 503);
      }
      const receipt = await service.bookPatient(request.headers, input);
      // The transaction has committed. A notification failure must not turn a saved
      // appointment into a failed response or trigger another booking attempt.
      try { await afterConfirmation(receipt); }
      catch { console.warn("Appointment confirmed, but its WhatsApp notification could not be sent (POST_COMMIT_FAILURE)."); }
      return respond({ receipt });
    } catch (error) { return failure(error); }
  };
}
