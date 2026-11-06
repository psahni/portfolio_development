import "server-only";
import { z } from "zod";

type StaffHandler = { handler(request: Request): Promise<Response> };
const prefix = "/api/auth/staff/";
const allowed = new Set(["sign-in/admin-pin", "email-otp/send-verification-otp", "sign-in/email-otp", "sign-out"]);
const codeRequest = z.object({ email: z.email(), type: z.literal("sign-in") });

function json(body: object, status = 200, headers?: Headers) {
  const safeHeaders = new Headers(headers);
  safeHeaders.delete("Content-Length");
  const response = Response.json(body, { status, headers: safeHeaders });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Expose only this task's staff login/logout endpoints, not the entire auth API. */
export function createStaffAuthHandler(getStaff: () => StaffHandler, getTrustedOrigin: () => string) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const action = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    if (!allowed.has(action)) return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, new Headers({ Allow: "POST" }));
    try {
      // Use the configured public origin; Next.js/proxies may use an internal request hostname.
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return json({ error: "Request origin is not permitted." }, 403);
      if (action === "email-otp/send-verification-otp") {
        const body = codeRequest.safeParse(await request.clone().json());
        if (!body.success) return json({ error: "Enter a valid email address." }, 400);
      }
      // Better Auth retains cookie signing, origin checks and existing attempt limits.
      const response = await getStaff().handler(request);
      if (action === "email-otp/send-verification-otp" && response.status === 401) {
        // Unknown, disabled and admin accounts receive the same response as eligible staff.
        return json({ success: true });
      }
      if (!response.ok) {
        const error = response.status === 429 ? "Too many attempts. Please try again shortly."
          : response.status >= 500 ? "Sign-in is temporarily unavailable. Please try again."
          : "Unable to sign in. Check your details and try again.";
        return json({ error }, response.status, response.headers);
      }
      // Keep session cookies while omitting tokens and user details from the response body.
      return json({ success: true }, response.status, response.headers);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: "Invalid request." }, 400);
      return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    }
  };
}
