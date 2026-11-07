import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import type { createSchedulingService } from "./service";
import { SchedulingError } from "./models";

export function createCalendarHandler(getService: () => ReturnType<typeof createSchedulingService>) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (request.method !== "GET") return respond({ error: "Method not allowed." }, 405);
      const params = new URL(request.url).searchParams;
      return respond({ calendar: await getService().calendar(request.headers, params.get("date") ?? undefined, params.get("view") ?? undefined) });
    } catch (error) {
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) return respond({ error: "Admin access is required." }, error.statusCode);
      if (error instanceof SchedulingError) return respond({ error: error.message }, error.statusCode);
      if (error instanceof ZodError) return respond({ error: error.issues[0].message }, 400);
      return respond({ error: "Calendar is temporarily unavailable. Please try again." }, 503);
    }
  };
}
