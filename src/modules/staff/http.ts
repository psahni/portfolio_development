import "server-only";
import { isAPIError } from "better-auth/api";
import { ZodError } from "zod";
import { StaffError } from "./models";
import type { createStaffService } from "./service";

export function createStaffHandler(getService: () => ReturnType<typeof createStaffService>, getTrustedOrigin: () => string) {
  return async (request: Request) => {
    const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (request.method === "GET") return respond({ staff: await getService().list(request.headers) });
      if (request.method !== "POST" && request.method !== "PATCH") return respond({ error: "Method not allowed." }, 405);
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const input: unknown = await request.json();
      const member = request.method === "POST" ? await getService().create(request.headers, input) : await getService().setActive(request.headers, input);
      return respond({ member }, request.method === "POST" ? 201 : 200);
    } catch (error) {
      if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) return respond({ error: "Admin access is required." }, error.statusCode);
      if (error instanceof StaffError) return respond({ error: error.message }, error.statusCode);
      if (error instanceof ZodError) return respond({ error: error.issues[0].message }, 400);
      if (error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
      return respond({ error: "Staff management is temporarily unavailable. Please try again." }, 503);
    }
  };
}
