import "server-only";
import { APIError } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { staffAccess, staffSession } from "@/db/schema/auth";

type StaffAuth = {
  api: {
    getSession(input: {
      headers: Headers;
      query: { disableCookieCache: true; disableRefresh: true };
    }): Promise<{ session: { id: string; userId: string; token: string } } | null>;
  };
};

export type ClinicPrincipal = {
  userId: string;
  sessionId: string;
  role: "admin" | "staff";
};

/** Run a check in each protected server operation; never cache the returned principal across requests. */
export function createAccessChecks(db: ApplicationDatabase, staffAuth: StaffAuth) {
  async function requireClinicAccess(headers: Headers): Promise<ClinicPrincipal> {
    // Only the staff auth instance may verify cookies; patient identities are never looked up by email.
    const authenticated = await staffAuth.api.getSession({
      headers, query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!authenticated) throw new APIError("UNAUTHORIZED", { message: "Sign in to continue." });

    // Re-read both rows on every check: revocation, expiry and access changes must not be cached.
    const { session } = authenticated;
    const [current] = await db.select({ role: staffAccess.role, active: staffAccess.active })
      .from(staffSession).leftJoin(staffAccess, eq(staffAccess.userId, staffSession.userId))
      .where(and(
        eq(staffSession.id, session.id), eq(staffSession.userId, session.userId),
        eq(staffSession.token, session.token), gt(staffSession.expiresAt, sql`CURRENT_TIMESTAMP`),
      )).limit(1);
    if (!current) throw new APIError("UNAUTHORIZED", { message: "Sign in to continue." });
    if (!current.active || (current.role !== "admin" && current.role !== "staff")) {
      throw new APIError("FORBIDDEN", { message: "Clinic access is not permitted." });
    }
    return { userId: session.userId, sessionId: session.id, role: current.role };
  }

  async function requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> {
    const principal = await requireClinicAccess(headers);
    if (principal.role !== "admin") {
      throw new APIError("FORBIDDEN", { message: "Admin access is required." });
    }
    return principal;
  }

  return { requireClinicAccess, requireAdminAccess };
}
