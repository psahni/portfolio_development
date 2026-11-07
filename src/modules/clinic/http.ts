import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import type { createClinicService } from "./service";
import { SchedulingError } from "@/modules/scheduling/models";

export function createClinicHandler(getService: () => ReturnType<typeof createClinicService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (request.method === "GET") return respond({ settings: await getService().get(request.headers) });
      if (request.method !== "PUT") return respond({ error: "Method not allowed." }, 405);
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const settings = await getService().save(request.headers, await request.json());
      return respond({ settings });
    } catch (error) {
      if (error instanceof SchedulingError) return respond({ error: error.message, conflicts: error.conflicts }, error.statusCode);
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) {
        return respond({ error: "Admin access is required." }, error.statusCode);
      }
      if (error instanceof ZodError) return respond({ error: error.issues[0].message }, 400);
      if (error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
      return respond({ error: "Clinic settings are temporarily unavailable. Please try again." }, 503);
    }
  };
}
