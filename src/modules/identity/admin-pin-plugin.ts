import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ApplicationDatabase } from "@/db/connection";
import { staffAccess, staffSession } from "@/db/schema/auth";
import { authenticateAdminPin, resetAdminPin } from "./admin-pin";

const pin = z.string().regex(/^\d{4}$/);
const denied = () => new APIError("UNAUTHORIZED", { message: "Unable to sign in or verify access." });

export function adminPinPlugin(db: ApplicationDatabase, options: { staffSecret: string; testMode: boolean; baseURL: string }) {
  return {
    id: "nuvortiq-admin-pin",
    endpoints: {
      signInAdminPin: createAuthEndpoint("/sign-in/admin-pin", {
        method: "POST", body: z.object({ email: z.email(), pin }),
      }, async (ctx) => {
        const verified = await authenticateAdminPin(db, { ...options, email: ctx.body.email, pin: ctx.body.pin });
        if (!verified) throw denied();
        const session = await ctx.context.internalAdapter.createSession(verified.user.id);
        if (!session) throw denied();
        // A PIN reset/deactivation racing login must not leave a new usable session.
        const [current] = await db.select({ id: staffAccess.userId }).from(staffAccess).where(and(
          eq(staffAccess.userId, verified.user.id), eq(staffAccess.active, true),
          eq(staffAccess.role, "admin"), eq(staffAccess.adminPinHash, verified.credentialVersion),
        ));
        if (!current) {
          await db.delete(staffSession).where(eq(staffSession.id, session.id));
          throw denied();
        }
        await setSessionCookie(ctx, { session, user: verified.user });
        return ctx.json({ success: true });
      }),
      resetAdminPin: createAuthEndpoint("/admin/reset-pin", {
        method: "POST", body: z.object({ currentPin: pin, newPin: pin.refine((value) => value !== "0000") }),
        use: [sessionMiddleware],
      }, async (ctx) => {
        const changed = await resetAdminPin(db, { userId: ctx.context.session.user.id, currentPin: ctx.body.currentPin, newPin: ctx.body.newPin, staffSecret: options.staffSecret });
        if (!changed) throw denied();
        await deleteSessionCookie(ctx);
        return ctx.json({ success: true, signInAgain: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}
