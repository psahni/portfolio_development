import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import type { createDoctorAppointmentsService } from "./doctor-appointments";
import { BookingError } from "./models";
import { SchedulingError } from "@/modules/scheduling/models";

export function createDoctorAppointmentsHandler(getService: () => ReturnType<typeof createDoctorAppointmentsService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    try {
      if (request.method === "GET") return respond(await getService().view(request.headers, new URL(request.url).searchParams.get("date") ?? undefined));
      if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const input: unknown = await request.json();
      return respond({ appointment: await getService().cancel(request.headers, input) });
    } catch (error) {
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) return respond({ error: "Active clinic access is required. Sign in again." }, error.statusCode);
      if (error instanceof BookingError) return respond({ code: error.code, error: error.message }, error.statusCode);
      if (error instanceof SchedulingError) return respond({ error: error.message }, error.statusCode);
      if (error instanceof ZodError) return respond({ error: error.issues[0].message }, 400);
      if (error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
      return respond({ error: "Appointments could not be checked. Refresh the list or retry the same cancellation." }, 503);
    }
  };
}
