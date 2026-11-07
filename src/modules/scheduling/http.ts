import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import type { createSchedulingService } from "./service";
import { SchedulingError } from "./models";

export function createSchedulingHandler(getService: () => ReturnType<typeof createSchedulingService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (request.method === "GET") return respond({ availability: await getService().preview(request.headers, new URL(request.url).searchParams.get("date") ?? undefined) });
      if (!["PUT", "POST", "DELETE"].includes(request.method)) return respond({ error: "Method not allowed." }, 405);
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const service = getService(), input: unknown = await request.json();
      if (request.method === "PUT") await service.saveOverride(request.headers, input);
      if (request.method === "POST") await service.addBreak(request.headers, input);
      if (request.method === "DELETE") await service.removeBreak(request.headers, input);
      return respond({ success: true });
    } catch (error) {
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) return respond({ error: "Admin access is required." }, error.statusCode);
      if (error instanceof SchedulingError) return respond({ error: error.message, conflicts: error.conflicts }, error.statusCode);
      if (error instanceof ZodError) return respond({ error: error.issues[0].message }, 400);
      if (error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
      return respond({ error: "Availability is temporarily unavailable. Please try again." }, 503);
    }
  };
}
