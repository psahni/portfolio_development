import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import { SchedulingError } from "@/modules/scheduling/models";
import type { createClinicBookingAvailability } from "./clinic-booking";
import type { createBookingService } from "./service";
import { BookingError } from "./models";

const respond = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
});
function failure(error: unknown) {
  if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN"))
    return respond({ error: "Active clinic access is required. Sign in again." }, error.statusCode);
  if (error instanceof BookingError) return respond({ code: error.code, error: error.message }, error.statusCode);
  if (error instanceof SchedulingError) return respond({ error: error.message }, error.statusCode);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return respond({ error: "Check the date, selected time, patient name, email and phone number." }, 400);
  return respond({ error: "Booking could not be checked. Retry the same confirmation or check the agenda." }, 503);
}

export function createClinicBookingHandler(getService: () => ReturnType<typeof createBookingService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
    try {
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin)
        return respond({ error: "Request origin is not permitted." }, 403);
      const input: unknown = await request.json();
      // Shared service resolves the clinic principal and commits before returning.
      const receipt = await getService().bookForClinic(request.headers, input);
      return respond({ receipt });
    } catch (error) { return failure(error); }
  };
}

export function createClinicAvailabilityHandler(getService: () => ReturnType<typeof createClinicBookingAvailability>) {
  return async (request: Request) => {
    if (request.method !== "GET") return respond({ error: "Method not allowed." }, 405);
    try { return respond(await getService().view(request.headers, new URL(request.url).searchParams.get("date") ?? undefined)); }
    catch (error) { return failure(error); }
  };
}
