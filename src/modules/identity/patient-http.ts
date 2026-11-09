import "server-only";
import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const codeRequest = z.object({ email, type: z.literal("sign-in") }).strict();
const codeSignIn = z.object({ email, otp: z.string().regex(/^(\d{4}|\d{6})$/) }).strict();
const prefix = "/api/auth/patient/";
const actions = new Set(["email-otp/send-verification-otp", "sign-in/email-otp", "sign-out"]);
type PatientAuth = { handler(request: Request): Promise<Response> };

export function createPatientAuthHandler(getPatient: () => PatientAuth, getTrustedOrigin: () => string, codesAvailable = () => true) {
  return async (request: Request): Promise<Response> => {
    const respond = (body: object, status = 200, headers?: Headers) => {
      const safe = new Headers(headers); safe.delete("Content-Length");
      safe.set("Cache-Control", "private, no-store"); safe.set("Vary", "Cookie");
      return Response.json(body, { status, headers: safe });
    };
    const pathname = new URL(request.url).pathname;
    const action = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    if (!actions.has(action)) return respond({ error: "Not found." }, 404);
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405, new Headers({ Allow: "POST" }));
    try {
      if (request.headers.get("origin") !== new URL(getTrustedOrigin()).origin) return respond({ error: "Request origin is not permitted." }, 403);
      const body = action === "sign-out" ? z.object({}).strict().parse(await request.json())
        : (action === "sign-in/email-otp" ? codeSignIn : codeRequest).parse(await request.json());
      if (action === "email-otp/send-verification-otp" && !codesAvailable()) return respond({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      const headers = new Headers(request.headers); headers.delete("Content-Length"); headers.set("Content-Type", "application/json");
      const response = await getPatient().handler(new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) }));
      if (response.status === 429) return respond({ error: "Too many attempts. Please try again shortly." }, 429, response.headers);
      if (response.status >= 500) return respond({ error: "Sign-in is temporarily unavailable. Please try again." }, 503, response.headers);
      // Do not reveal whether an address exists, including in localhost test mode.
      if (action === "email-otp/send-verification-otp" && (response.ok || response.status === 401)) return respond({ success: true }, 200, response.headers);
      if (!response.ok) return respond({ error: "That code is invalid or expired. Request a new code and try again." }, response.status, response.headers);
      // Preserve HTTP-only cookies; omit raw tokens and user records from the response.
      return respond({ success: true }, 200, response.headers);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return respond({ error: "Enter a valid email address and sign-in code." }, 400);
      return respond({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
    }
  };
}
