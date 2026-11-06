import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { ApplicationDatabase } from "@/db/connection";
import { staffAccess, staffSession, staffUser } from "@/db/schema/auth";
import { resolveTestAuthMode, TEST_LOGIN_CODE } from "./test-mode";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60_000;

function pinMaterial(pin: string, secret: string) {
  if (secret.length < 32) throw new Error("A staff authentication secret is required.");
  return createHmac("sha256", secret).update(pin).digest("hex");
}

function assertNewPin(pin: string) {
  if (!/^\d{4}$/.test(pin) || pin === TEST_LOGIN_CODE) {
    throw new Error("Choose a four-digit PIN other than the reserved test code.");
  }
}

export async function bootstrapAdmin(db: ApplicationDatabase, input: { email: string; name: string; pin: string; staffSecret: string }) {
  assertNewPin(input.pin);
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success || !input.name.trim()) throw new Error("A valid admin email and name are required.");
  const pinHash = await hashPassword(pinMaterial(input.pin, input.staffSecret));
  return db.transaction(async (tx) => {
    // Serializes bootstrap only; never locks booking operations or changes an existing PIN.
    await tx.execute(sql`select pg_advisory_xact_lock(731042)`);
    const [existing] = await tx.select({ email: staffUser.email }).from(staffAccess)
      .innerJoin(staffUser, eq(staffUser.id, staffAccess.userId)).where(eq(staffAccess.role, "admin"));
    if (existing) {
      if (existing.email !== email) throw new Error("An admin already exists; bootstrap cannot replace it.");
      return { created: false };
    }
    const id = randomUUID();
    await tx.insert(staffUser).values({ id, email, name: input.name, emailVerified: false });
    await tx.insert(staffAccess).values({ userId: id, role: "admin", adminPinHash: pinHash });
    return { created: true };
  });
}

type PinLogin = { email: string; pin: string; staffSecret: string; testMode: boolean; baseURL: string };

/** Failed counters commit before a caller rejects authentication. Never throw inside that transaction. */
export async function authenticateAdminPin(db: ApplicationDatabase, input: PinLogin) {
  const allowTestCode = resolveTestAuthMode(input.testMode, input.baseURL);
  if (!/^\d{4}$/.test(input.pin)) return null;
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ access: staffAccess, user: staffUser }).from(staffAccess)
      .innerJoin(staffUser, eq(staffUser.id, staffAccess.userId))
      .where(and(eq(staffUser.email, input.email.trim().toLowerCase()), eq(staffAccess.role, "admin"))).for("update");
    if (!record?.access.active || !record.access.adminPinHash) return null;
    const now = new Date();
    if (record.access.pinLockedUntil && record.access.pinLockedUntil > now) return null;
    const correct = (allowTestCode && input.pin === TEST_LOGIN_CODE) || await verifyPassword({
      hash: record.access.adminPinHash, password: pinMaterial(input.pin, input.staffSecret),
    });
    const attempts = record.access.pinLockedUntil ? 0 : record.access.failedPinAttempts;
    if (!correct) {
      await tx.update(staffAccess).set({
        failedPinAttempts: attempts + 1,
        pinLockedUntil: attempts + 1 >= MAX_PIN_ATTEMPTS ? new Date(now.getTime() + PIN_LOCK_MS) : null,
        updatedAt: now,
      }).where(eq(staffAccess.userId, record.user.id));
      return null;
    }
    await tx.update(staffAccess).set({ failedPinAttempts: 0, pinLockedUntil: null, updatedAt: now }).where(eq(staffAccess.userId, record.user.id));
    return { user: record.user, credentialVersion: record.access.adminPinHash };
  });
}

/** Caller must authenticate a staff-scoped session first. Rechecks active admin and current PIN. */
export async function resetAdminPin(db: ApplicationDatabase, input: { userId: string; currentPin: string; newPin: string; staffSecret: string }) {
  assertNewPin(input.newPin);
  const newHash = await hashPassword(pinMaterial(input.newPin, input.staffSecret));
  return db.transaction(async (tx) => {
    const [access] = await tx.select().from(staffAccess).where(eq(staffAccess.userId, input.userId)).for("update");
    if (!access?.active || access.role !== "admin" || !access.adminPinHash) return false;
    const now = new Date();
    if (access.pinLockedUntil && access.pinLockedUntil > now) return false;
    const correct = /^\d{4}$/.test(input.currentPin) && await verifyPassword({ hash: access.adminPinHash, password: pinMaterial(input.currentPin, input.staffSecret) });
    if (!correct) {
      const attempts = (access.pinLockedUntil ? 0 : access.failedPinAttempts) + 1;
      await tx.update(staffAccess).set({ failedPinAttempts: attempts, pinLockedUntil: attempts >= MAX_PIN_ATTEMPTS ? new Date(now.getTime() + PIN_LOCK_MS) : null, updatedAt: now }).where(eq(staffAccess.userId, input.userId));
      return false;
    }
    await tx.update(staffAccess).set({ adminPinHash: newHash, failedPinAttempts: 0, pinLockedUntil: null, updatedAt: now }).where(eq(staffAccess.userId, input.userId));
    await tx.delete(staffSession).where(eq(staffSession.userId, input.userId));
    return true;
  });
}
