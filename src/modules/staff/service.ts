import "server-only";
import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { staffAccess, staffSession, staffUser, staffVerification } from "@/db/schema/auth";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { createStaffSchema, staffStatusSchema, StaffError, type StaffMember } from "./models";

type AdminAccess = { requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> };
type Transaction = Parameters<Parameters<ApplicationDatabase["transaction"]>[0]>[0];
const fields = { userId: staffUser.id, name: staffUser.name, email: staffUser.email, active: staffAccess.active };

export function createStaffService(db: ApplicationDatabase, access: AdminAccess) {
  async function authorizeWrite(tx: Transaction, principal: ClinicPrincipal) {
    // Serialize staff edits, then recheck access/session after any lock wait.
    const [admin] = await tx.select({ role: staffAccess.role, active: staffAccess.active })
      .from(staffAccess).where(eq(staffAccess.userId, principal.userId)).for("update");
    const [session] = await tx.select({ id: staffSession.id }).from(staffSession).where(and(
      eq(staffSession.id, principal.sessionId), eq(staffSession.userId, principal.userId),
      gt(staffSession.expiresAt, sql`clock_timestamp()`),
    ));
    if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in to continue." });
    if (!admin?.active || admin.role !== "admin") throw new APIError("FORBIDDEN", { message: "Admin access is required." });
  }

  async function list(headers: Headers): Promise<StaffMember[]> {
    await access.requireAdminAccess(headers);
    return db.select(fields).from(staffUser).innerJoin(staffAccess, eq(staffAccess.userId, staffUser.id))
      .where(eq(staffAccess.role, "staff")).orderBy(asc(staffUser.name), asc(staffUser.email));
  }

  async function create(headers: Headers, input: unknown): Promise<StaffMember> {
    const principal = await access.requireAdminAccess(headers);
    const value = createStaffSchema.parse(input);
    return db.transaction(async (tx) => {
      await authorizeWrite(tx, principal);
      const [user] = await tx.insert(staffUser).values({ id: randomUUID(), ...value })
        .onConflictDoNothing({ target: staffUser.email }).returning({ id: staffUser.id });
      if (!user) throw new StaffError(409, "A clinic account already uses this email address.");
      await tx.insert(staffAccess).values({ userId: user.id, role: "staff", active: true });
      return { userId: user.id, ...value, active: true };
    });
  }

  async function setActive(headers: Headers, input: unknown): Promise<StaffMember> {
    const principal = await access.requireAdminAccess(headers);
    const value = staffStatusSchema.parse(input);
    return db.transaction(async (tx) => {
      await authorizeWrite(tx, principal);
      const [member] = await tx.select(fields).from(staffUser).innerJoin(staffAccess, eq(staffAccess.userId, staffUser.id))
        .where(and(eq(staffAccess.userId, value.userId), eq(staffAccess.role, "staff"))).for("update");
      if (!member) throw new StaffError(404, "Staff member was not found.");
      await tx.update(staffAccess).set({ active: value.active, updatedAt: new Date() }).where(eq(staffAccess.userId, member.userId));
      if (!value.active) {
        await tx.delete(staffSession).where(eq(staffSession.userId, member.userId));
        await tx.delete(staffVerification).where(eq(staffVerification.identifier, `sign-in-otp-${member.email}`));
      }
      return { ...member, active: value.active };
    });
  }

  return { list, create, setActive };
}
