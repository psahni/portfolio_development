import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@/db/connection";
import { patientUser, patientVerification, staffUser, staffAccess, staffSession } from "@/db/schema/auth";
import { createIdentity } from "@/modules/identity/create-auth";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import type { LoginCode } from "@/platform/mail";

const baseURL = "http://localhost:3000";
const adminEmail = "doctor@example.test";
const staffEmail = "reception@example.test";
const initialPin = "4821";
const staffSecret = "staff-integration-secret-" + "b".repeat(32);
const mailbox: (LoginCode & { audience: "patient" | "staff" })[] = [];
let database: ReturnType<typeof createDatabase>;
let identity: ReturnType<typeof createIdentity>;
let adminId: string;

function makeIdentity(testMode = false) {
  return createIdentity({
    db: database.db, baseURL, testMode,
    patientSecret: "patient-integration-secret-" + "a".repeat(32), staffSecret,
    mailer: {
      async sendPatientLoginCode(message) { mailbox.push({ ...message, audience: "patient" }); },
      async sendStaffLoginCode(message) { mailbox.push({ ...message, audience: "staff" }); },
    },
  });
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function approveStaff(email: string, active = true) {
  const id = randomUUID();
  await database.db.insert(staffUser).values({ id, name: "Synthetic Staff", email });
  await database.db.insert(staffAccess).values({ userId: id, role: "staff", active });
  return id;
}

async function emailLogin(audience: "patient" | "staff", email: string) {
  const auth = identity[audience];
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const code = mailbox.findLast((message) => message.email === email && message.audience === audience)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const response = await auth.api.signInEmailOTP({ body: { email, otp: code! }, asResponse: true });
  expect(response.status).toBe(200);
  return { response, code: code! };
}

async function adminLogin(pin = initialPin, auth = identity) {
  return auth.staff.api.signInAdminPin({ body: { email: adminEmail, pin }, asResponse: true });
}

beforeAll(async () => {
  database = createDatabase(inject("databaseUrl"));
  // Prove an upgrade from the already-published M1 migration without rewriting its SQL.
  const previous = await mkdtemp(join(tmpdir(), "nuvortiq-m1-migrations-"));
  try {
    await mkdir(join(previous, "meta"));
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    await copyFile("drizzle/0000_auth_foundation.sql", join(previous, "0000_auth_foundation.sql"));
    await writeFile(join(previous, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
    await migrate(database.db, { migrationsFolder: previous });
    await database.db.insert(patientUser).values({ id: "legacy-patient", name: "Before upgrade", email: "legacy@example.test" });
    await migrate(database.db, { migrationsFolder: "./drizzle" });
  } finally { await rm(previous, { recursive: true, force: true }); }
  const boot = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/bootstrap-admin.ts"], {
    env: {
      ...process.env, NODE_ENV: "test", APP_URL: baseURL,
      DATABASE_URL: inject("databaseUrl"), MIGRATION_DATABASE_URL: inject("databaseUrl"),
      PATIENT_AUTH_SECRET: "patient-integration-secret-" + "a".repeat(32), STAFF_AUTH_SECRET: staffSecret,
      AUTH_TEST_MODE: "false", BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      BOOTSTRAP_ADMIN_NAME: "Synthetic Doctor", BOOTSTRAP_ADMIN_PIN: initialPin,
    }, timeout: 20_000,
  });
  expect(boot.stdout).toContain("Admin created");
  expect(boot.stdout + boot.stderr).not.toContain(initialPin);
  const access = await database.db.select().from(staffAccess);
  expect(access).toHaveLength(1);
  expect(access[0].role).toBe("admin");
  adminId = access[0].userId;
  await approveStaff(staffEmail);
  identity = makeIdentity();
});

afterAll(async () => { await database?.pool.end(); });

describe("PostgreSQL and migrations", () => {
  it("replays migrations and upgrades M1 without losing existing users", async () => {
    const version = await database.db.execute(sql`select current_setting('server_version_num')::int as version`);
    expect(Number(version.rows[0].version)).toBeGreaterThanOrEqual(170000);
    await expect(migrate(database.db, { migrationsFolder: "./drizzle" })).resolves.toBeUndefined();
    expect(await database.db.select().from(patientUser).where(eq(patientUser.id, "legacy-patient"))).toHaveLength(1);
  });
  it("rolls back partial identity changes", async () => {
    const id = randomUUID();
    await expect(database.db.transaction(async (tx) => {
      await tx.insert(patientUser).values({ id, name: "Rollback", email: "rollback@example.test" });
      throw new Error("simulated failure");
    })).rejects.toThrow("simulated failure");
    expect(await database.db.select().from(patientUser).where(eq(patientUser.id, id))).toHaveLength(0);
  });
  it("bootstrap creates one admin, never resets the PIN and rejects a replacement admin", async () => {
    const [before] = await database.db.select().from(staffAccess).where(eq(staffAccess.userId, adminId));
    expect(before.adminPinHash).not.toBe(initialPin);
    expect(await bootstrapAdmin(database.db, { email: adminEmail, name: "Ignored", pin: "7531", staffSecret })).toEqual({ created: false });
    const [after] = await database.db.select().from(staffAccess).where(eq(staffAccess.userId, adminId));
    expect(after.adminPinHash).toBe(before.adminPinHash);
    await expect(bootstrapAdmin(database.db, { email: "other@example.test", name: "Other", pin: "7531", staffSecret })).rejects.toThrow("already exists");
    await expect(bootstrapAdmin(database.db, { email: adminEmail, name: "Doctor", pin: "0000", staffSecret })).rejects.toThrow("reserved test code");
  });
});

describe("email-code authentication", () => {
  it.each(["patient", "staff"] as const)("%s codes are single-use and never grant access in the other realm", async (audience) => {
    const email = audience === "staff" ? staffEmail : "patient@example.test";
    const { response, code } = await emailLogin(audience, email);
    const session = await identity[audience].api.getSession({ headers: new Headers({ cookie: cookies(response) }) });
    expect(session?.user.email).toBe(email);
    const other = audience === "staff" ? "patient" : "staff";
    expect(await identity[other].api.getSession({ headers: new Headers({ cookie: cookies(response) }) })).toBeNull();
    const replay = await identity[audience].api.signInEmailOTP({ body: { email, otp: code }, asResponse: true });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    if (audience === "patient") expect(await database.db.select().from(staffUser).where(eq(staffUser.email, email))).toHaveLength(0);
  });
  it("keeps same-email patient and staff identities separate", async () => {
    const { response } = await emailLogin("patient", staffEmail);
    expect(cookies(response)).toContain("nuvortiq-patient");
    expect(await identity.staff.api.getSession({ headers: new Headers({ cookie: cookies(response) }) })).toBeNull();
    const { response: staff } = await emailLogin("staff", staffEmail);
    expect(cookies(staff)).toContain("nuvortiq-staff");
    expect(await identity.patient.api.getSession({ headers: new Headers({ cookie: cookies(staff) }) })).toBeNull();
  });
  it("rejects expired codes and stores their digest", async () => {
    const email = "expired@example.test";
    await identity.patient.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = mailbox.findLast((message) => message.email === email)!.code;
    const record = (await database.db.select().from(patientVerification)).find((value) => value.identifier.includes(email))!;
    expect(record.value.split(":")[0]).not.toBe(code);
    await database.db.update(patientVerification).set({ expiresAt: new Date(0) }).where(eq(patientVerification.id, record.id));
    const response = await identity.patient.api.signInEmailOTP({ body: { email, otp: code }, asResponse: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("exhausts codes after three incorrect attempts", async () => {
    const email = "attempts@example.test";
    await identity.patient.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = mailbox.findLast((message) => message.email === email)!.code;
    for (let attempt = 0; attempt < 3; attempt++) {
      await identity.patient.api.signInEmailOTP({ body: { email, otp: code === "000000" ? "999999" : "000000" }, asResponse: true });
    }
    expect((await identity.patient.api.signInEmailOTP({ body: { email, otp: code }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
  });
  it("rejects unknown/inactive staff and admin email-code login", async () => {
    await approveStaff("inactive@example.test", false);
    for (const email of ["unknown@example.test", "inactive@example.test", adminEmail]) {
      for (const path of ["email-otp/send-verification-otp", "sign-in/email-otp"]) {
        const response = await identity.staff.handler(new Request(`${baseURL}/api/auth/staff/${path}`, {
          method: "POST", headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({ email, type: "sign-in", otp: "0000" }),
        }));
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
  });
  it("disables password login and signup in both realms", async () => {
    for (const realm of ["staff", "patient"] as const) {
      for (const action of ["sign-up", "sign-in"]) {
        const response = await identity[realm].handler(new Request(`${baseURL}/api/auth/${realm}/${action}/email`, {
          method: "POST", headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({ email: "intruder@example.test", name: "Intruder", password: "unused-test-password" }),
        }));
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
  });
});

describe("clinic and admin access checks", () => {
  it("allows an active admin into the clinic and admin-only actions", async () => {
    const response = await adminLogin();
    expect(response.status).toBe(200);
    const headers = new Headers({ cookie: cookies(response) });
    const principal = await identity.access.requireClinicAccess(headers);
    expect(principal).toEqual({ userId: adminId, sessionId: expect.any(String), role: "admin" });
    expect(await identity.access.requireAdminAccess(headers)).toEqual(principal);
  });

  it("allows active staff into the clinic but rejects admin-only actions and role spoofing", async () => {
    const { response } = await emailLogin("staff", staffEmail);
    const headers = new Headers({ cookie: cookies(response), "x-user-role": "admin", "x-user-id": adminId });
    expect(await identity.access.requireClinicAccess(headers)).toEqual({
      userId: expect.any(String), sessionId: expect.any(String), role: "staff",
    });
    await expect(identity.access.requireAdminAccess(headers)).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it.each(["", "nuvortiq-staff.session_token=forged-session"])("rejects missing or invalid session cookies: %s", async (cookie) => {
    const headers = new Headers({ cookie, "x-user-role": "admin", "x-user-id": adminId });
    for (const guard of [identity.access.requireClinicAccess, identity.access.requireAdminAccess]) {
      await expect(guard(headers)).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    }
  });

  it.each([staffEmail, adminEmail])("rejects patient sessions sharing the clinic email %s", async (email) => {
    const { response } = await emailLogin("patient", email);
    const cookie = cookies(response);
    // Renaming a patient cookie must not turn it into a valid staff credential.
    for (const value of [cookie, cookie.replaceAll("nuvortiq-patient", "nuvortiq-staff")]) {
      const headers = new Headers({ cookie: value });
      for (const guard of [identity.access.requireClinicAccess, identity.access.requireAdminAccess]) {
        await expect(guard(headers)).rejects.toMatchObject({ status: "UNAUTHORIZED" });
      }
    }
  });

  it.each(["staff", "admin"] as const)("blocks an existing %s session immediately after disabling access", async (role) => {
    const response = role === "admin" ? await adminLogin() : (await emailLogin("staff", staffEmail)).response;
    const headers = new Headers({ cookie: cookies(response) });
    const principal = await identity.access.requireClinicAccess(headers);
    await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, principal.userId));
    try {
      // The session still exists: the denial must come from the current access record.
      expect(await identity.staff.api.getSession({ headers })).not.toBeNull();
      for (const guard of [identity.access.requireClinicAccess, identity.access.requireAdminAccess]) {
        await expect(guard(headers)).rejects.toMatchObject({ status: "FORBIDDEN" });
      }
    } finally {
      await database.db.update(staffAccess).set({ active: true }).where(eq(staffAccess.userId, principal.userId));
    }
  });

  it.each(["expired", "revoked"] as const)("rejects a previously accepted session after it is %s", async (state) => {
    const { response } = await emailLogin("staff", staffEmail);
    const headers = new Headers({ cookie: cookies(response) });
    const principal = await identity.access.requireClinicAccess(headers);
    if (state === "expired") {
      await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.id, principal.sessionId));
    } else {
      await database.db.delete(staffSession).where(eq(staffSession.id, principal.sessionId));
    }
    for (const guard of [identity.access.requireClinicAccess, identity.access.requireAdminAccess]) {
      await expect(guard(headers)).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    }
  });

  it("rejects a valid session when its staff access record is removed", async () => {
    const email = "removed-access@example.test";
    const userId = await approveStaff(email);
    const { response } = await emailLogin("staff", email);
    const headers = new Headers({ cookie: cookies(response) });
    await expect(identity.access.requireClinicAccess(headers)).resolves.toMatchObject({ userId });
    await database.db.delete(staffAccess).where(eq(staffAccess.userId, userId));
    expect(await identity.staff.api.getSession({ headers })).not.toBeNull();
    for (const guard of [identity.access.requireClinicAccess, identity.access.requireAdminAccess]) {
      await expect(guard(headers)).rejects.toMatchObject({ status: "FORBIDDEN" });
    }
  });

  it("uses the latest database role rather than a previous access result", async () => {
    const response = await adminLogin();
    const headers = new Headers({ cookie: cookies(response) });
    await expect(identity.access.requireAdminAccess(headers)).resolves.toMatchObject({ role: "admin" });
    const [original] = await database.db.select().from(staffAccess).where(eq(staffAccess.userId, adminId));
    await database.db.update(staffAccess).set({ role: "staff", adminPinHash: null }).where(eq(staffAccess.userId, adminId));
    try {
      await expect(identity.access.requireClinicAccess(headers)).resolves.toMatchObject({ role: "staff" });
      await expect(identity.access.requireAdminAccess(headers)).rejects.toMatchObject({ status: "FORBIDDEN" });
    } finally {
      await database.db.update(staffAccess).set({ role: "admin", adminPinHash: original.adminPinHash }).where(eq(staffAccess.userId, adminId));
    }
  });
});

describe("admin PIN", () => {
  it("never permits staff PIN login, even with a known admin PIN, test code or spoofed role", async () => {
    const [user] = await database.db.select().from(staffUser).where(eq(staffUser.email, staffEmail));
    const before = await database.db.select().from(staffSession).where(eq(staffSession.userId, user.id));
    for (const auth of [identity, makeIdentity(true)]) {
      for (const pin of [initialPin, "0000"]) {
        const response = await auth.staff.handler(new Request(`${baseURL}/api/auth/staff/sign-in/admin-pin`, {
          method: "POST", headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({ email: staffEmail, pin, role: "admin" }),
        }));
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
    expect(await database.db.select().from(staffSession).where(eq(staffSession.userId, user.id))).toHaveLength(before.length);
  });
  it("creates an admin session with the real PIN and rejects test code by default", async () => {
    expect((await adminLogin("0000")).status).toBeGreaterThanOrEqual(400);
    const response = await adminLogin();
    expect(response.status).toBe(200);
    expect((await identity.staff.api.getSession({ headers: new Headers({ cookie: cookies(response) }) }))?.user.id).toBe(adminId);
    expect(await identity.patient.api.getSession({ headers: new Headers({ cookie: cookies(response) }) })).toBeNull();
  });
  it("serializes five concurrent failures into a persistent 15-minute lockout", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => adminLogin("1111")));
    expect(results.every((response) => response.status >= 400)).toBe(true);
    const [access] = await database.db.select().from(staffAccess).where(eq(staffAccess.userId, adminId));
    expect(access.failedPinAttempts).toBe(5);
    expect(access.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect((await adminLogin()).status).toBeGreaterThanOrEqual(400);
    expect((await adminLogin("0000", makeIdentity(true))).status).toBeGreaterThanOrEqual(400);
    await database.db.update(staffAccess).set({ pinLockedUntil: new Date(0) }).where(eq(staffAccess.userId, adminId));
    expect((await adminLogin()).status).toBe(200);
  });
  it("requires admin session plus current PIN, and revokes sessions on PIN reset", async () => {
    const { response: staff } = await emailLogin("staff", staffEmail);
    const { response: patient } = await emailLogin("patient", adminEmail);
    for (const cookie of [cookies(staff), cookies(patient), ""]) {
      const response = await identity.staff.api.resetAdminPin({ body: { currentPin: initialPin, newPin: "7531" }, headers: new Headers({ cookie }), asResponse: true });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const response = await adminLogin();
    const cookie = cookies(response);
    const denied = await identity.staff.api.resetAdminPin({ body: { currentPin: "0000", newPin: "7531" }, headers: new Headers({ cookie }), asResponse: true });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const changed = await identity.staff.api.resetAdminPin({ body: { currentPin: initialPin, newPin: "7531" }, headers: new Headers({ cookie }), asResponse: true });
    expect(changed.status).toBe(200);
    expect(await identity.staff.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    await expect(identity.access.requireAdminAccess(new Headers({ cookie }))).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect((await adminLogin(initialPin)).status).toBeGreaterThanOrEqual(400);
    expect((await adminLogin("7531")).status).toBe(200);
  });
});

describe("local test master code", () => {
  it("allows 0000 only with opt-in, existing accounts and a requested email code", async () => {
    const testIdentity = makeIdentity(true);
    const before = mailbox.length;
    expect((await adminLogin("0000", testIdentity)).status).toBe(200);
    expect((await testIdentity.staff.api.signInAdminPin({ body: { email: "unknown@example.test", pin: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
    for (const audience of ["patient", "staff"] as const) {
      const email = audience === "patient" ? "legacy@example.test" : staffEmail;
      expect((await testIdentity[audience].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
      await testIdentity[audience].api.sendVerificationOTP({ body: { email, type: "sign-in" } });
      const response = await testIdentity[audience].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true });
      expect(response.status).toBe(200);
      expect((await testIdentity[audience].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
    }
    await testIdentity.patient.api.sendVerificationOTP({ body: { email: "new-test-user@example.test", type: "sign-in" } });
    expect((await testIdentity.patient.api.signInEmailOTP({ body: { email: "new-test-user@example.test", otp: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
    expect(mailbox).toHaveLength(before);
  });
  it("test code never bypasses inactive accounts", async () => {
    const testIdentity = makeIdentity(true);
    await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, adminId));
    try { expect((await adminLogin("0000", testIdentity)).status).toBeGreaterThanOrEqual(400); }
    finally { await database.db.update(staffAccess).set({ active: true }).where(eq(staffAccess.userId, adminId)); }
    const response = await testIdentity.staff.handler(new Request(`${baseURL}/api/auth/staff/email-otp/send-verification-otp`, {
      method: "POST", headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "inactive@example.test", type: "sign-in" }),
    }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("0000 is not a normal patient or staff code", async () => {
    for (const audience of ["patient", "staff"] as const) {
      const email = audience === "patient" ? "legacy@example.test" : staffEmail;
      await identity[audience].api.sendVerificationOTP({ body: { email, type: "sign-in" } });
      expect((await identity[audience].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
    }
  });
});
