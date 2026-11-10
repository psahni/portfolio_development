import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import { BookingError } from "./models";
import type { createPatientCancellationService } from "./patient-cancellation";

export function createPatientCancellationHandler(getService: () => ReturnType<typeof createPatientCancellationService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
    try {
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const input: unknown = await request.json();
      return respond({ appointment: await getService().cancel(request.headers, input) });
    } catch (error) {
      if (isAPIError(error) && error.status === "UNAUTHORIZED") return respond({ code: "SIGN_IN_REQUIRED", error: "Sign in to cancel your appointment." }, 401);
      if (error instanceof BookingError) return respond({ code: error.code, error: error.message }, error.statusCode);
      if (error instanceof ZodError || error instanceof SyntaxError) return respond({ error: "Choose a valid appointment." }, 400);
      return respond({ error: "Cancellation couldn’t be checked. Retry cancellation or refresh My appointments." }, 503);
    }
  };
}
