import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@/db/connection";
import { patientUser, staffAccess, staffSession, staffUser, staffVerification } from "@/db/schema/auth";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import { createIdentity } from "@/modules/identity/create-auth";
import { createStaffAuthHandler } from "@/modules/identity/http";
import { unconfiguredMailer } from "@/platform/mail";
import { createStaffService } from "@/modules/staff/service";
import { createStaffHandler } from "@/modules/staff/http";

const baseURL = "http://localhost:3000";
const adminEmail = "staff-doctor@example.test";
let database: ReturnType<typeof createDatabase>;
let identity: ReturnType<typeof createIdentity>;
let service: ReturnType<typeof createStaffService>;
let handle: ReturnType<typeof createStaffHandler>;
let adminId: string;
let fixedStaffId: string;
const credentials: Record<string, Headers> = { anonymous: new Headers() };
const details = { name: "New Receptionist", email: "new-staff@example.test" };

function sessionHeaders(response: Response) {
  expect(response.status).toBe(200);
  return new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
}
function request(method: string, headers = credentials.admin, body?: unknown, origin = baseURL) {
  const copy = new Headers(headers); copy.set("origin", origin); copy.set("content-type", "application/json");
  return new Request(`${baseURL}/api/admin/staff`, { method, headers: copy, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(email: string) {
  await identity.staff.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  return sessionHeaders(await identity.staff.api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true }));
}

beforeAll(async () => {
  const url = new URL(inject("databaseUrl"));
  const client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE staff_management_test"); }
  finally { await client.end(); }
  url.pathname = "/staff_management_test"; database = createDatabase(url.toString());
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  const staffSecret = "staff-management-" + "b".repeat(48);
  await bootstrapAdmin(database.db, { email: adminEmail, name: "Synthetic Doctor", pin: "4821", staffSecret });
  const [admin] = await database.db.select().from(staffAccess).where(eq(staffAccess.role, "admin")); adminId = admin.userId;
  identity = createIdentity({ db: database.db, baseURL, testMode: true, staffSecret, patientSecret: "staff-patient-" + "a".repeat(48), mailer: unconfiguredMailer });
  credentials.admin = sessionHeaders(await identity.staff.api.signInAdminPin({ body: { email: adminEmail, pin: "4821" }, asResponse: true }));
  fixedStaffId = randomUUID();
  await database.db.insert(staffUser).values({ id: fixedStaffId, name: "Existing Staff", email: "existing-staff@example.test" });
  await database.db.insert(staffAccess).values({ userId: fixedStaffId, role: "staff" });
  credentials.staff = await login("existing-staff@example.test");
  await database.db.insert(patientUser).values({ id: randomUUID(), name: "Same-email Patient", email: adminEmail });
  await identity.patient.api.sendVerificationOTP({ body: { email: adminEmail, type: "sign-in" } });
  credentials.patient = sessionHeaders(await identity.patient.api.signInEmailOTP({ body: { email: adminEmail, otp: "0000" }, asResponse: true }));
  service = createStaffService(database.db, identity.access);
  handle = createStaffHandler(() => service, () => baseURL);
});
beforeEach(async () => {
  const members = await database.db.select({ id: staffUser.id }).from(staffUser);
  for (const member of members) if (member.id !== adminId && member.id !== fixedStaffId) await database.db.delete(staffUser).where(eq(staffUser.id, member.id));
});
afterAll(async () => { await database?.pool.end(); });

describe("admin-managed staff persistence", () => {
  it("creates an unverified staff identity and access atomically, normalizes email and exposes only safe list fields", async () => {
    const member = await service.create(credentials.admin, { name: "  New Receptionist  ", email: " NEW-STAFF@EXAMPLE.TEST " });
    expect(member).toEqual({ userId: expect.any(String), ...details, active: true });
    expect(await service.list(credentials.admin)).toEqual([{ userId: fixedStaffId, name: "Existing Staff", email: "existing-staff@example.test", active: true }, member]);
    expect(await database.db.select().from(staffUser).where(eq(staffUser.id, member.userId))).toMatchObject([{ emailVerified: false }]);
    expect(await database.db.select().from(staffAccess).where(eq(staffAccess.userId, member.userId))).toMatchObject([{ role: "staff", adminPinHash: null }]);
  });

  it.each([details.email, adminEmail])("reports duplicate clinic email %s without partial records or changes to the original", async (email) => {
    if (email === details.email) await service.create(credentials.admin, details);
    const beforeUsers = await database.db.select().from(staffUser);
    const beforeAccess = await database.db.select().from(staffAccess);
    const response = await handle(request("POST", credentials.admin, { ...details, email: ` ${email.toUpperCase()} ` }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A clinic account already uses this email address." });
    expect(await database.db.select().from(staffUser)).toEqual(beforeUsers);
    expect(await database.db.select().from(staffAccess)).toEqual(beforeAccess);
  });

  it("allows a matching patient email without linking or changing the patient identity", async () => {
    const patientId = randomUUID();
    await database.db.insert(patientUser).values({ id: patientId, name: "Patient", email: details.email });
    const member = await service.create(credentials.admin, details);
    expect(member.userId).not.toBe(patientId);
    expect(await database.db.select().from(patientUser).where(eq(patientUser.id, patientId))).toMatchObject([{ name: "Patient", email: details.email }]);
  });

  it("serializes concurrent duplicate creation to one identity/access pair", async () => {
    const responses = await Promise.all([handle(request("POST", credentials.admin, details)), handle(request("POST", credentials.admin, details))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const users = await database.db.select().from(staffUser).where(eq(staffUser.email, details.email));
    expect(users).toHaveLength(1);
    expect(await database.db.select().from(staffAccess).where(eq(staffAccess.userId, users[0].id))).toHaveLength(1);
  });

  it("rolls back identity creation when saving access fails and returns a safe error", async () => {
    await database.db.execute(sql`ALTER TABLE staff_access ADD CONSTRAINT simulate_staff_failure CHECK (role = 'admin') NOT VALID`);
    try {
      const response = await handle(request("POST", credentials.admin, details));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Staff management is temporarily unavailable. Please try again." });
      expect(await database.db.select().from(staffUser).where(eq(staffUser.email, details.email))).toHaveLength(0);
    } finally { await database.db.execute(sql`ALTER TABLE staff_access DROP CONSTRAINT simulate_staff_failure`); }
  });

  it("disables access, revokes all sessions and pending codes, and requires fresh login after re-enabling", async () => {
    const member = await service.create(credentials.admin, details);
    const first = await login(details.email), second = await login(details.email);
    await identity.staff.api.sendVerificationOTP({ body: { email: details.email, type: "sign-in" } });
    expect(await database.db.select().from(staffSession).where(eq(staffSession.userId, member.userId))).toHaveLength(2);
    await service.setActive(credentials.admin, { userId: member.userId, active: false });
    await service.setActive(credentials.admin, { userId: member.userId, active: false });
    expect((await service.list(credentials.admin)).find((entry) => entry.userId === member.userId)?.active).toBe(false);
    expect(await database.db.select().from(staffSession).where(eq(staffSession.userId, member.userId))).toHaveLength(0);
    expect(await database.db.select().from(staffVerification).where(eq(staffVerification.identifier, `sign-in-otp-${details.email}`))).toHaveLength(0);
    await expect(identity.staff.api.sendVerificationOTP({ body: { email: details.email, type: "sign-in" } })).rejects.toThrow();
    await expect(identity.staff.api.signInEmailOTP({ body: { email: details.email, otp: "0000" }, asResponse: true })).rejects.toThrow();
    await service.setActive(credentials.admin, { userId: member.userId, active: true });
    for (const headers of [first, second]) await expect(identity.access.requireClinicAccess(headers)).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect((await identity.staff.api.signInEmailOTP({ body: { email: details.email, otp: "0000" }, asResponse: true })).status).toBeGreaterThanOrEqual(400);
    await expect(identity.access.requireClinicAccess(await login(details.email))).resolves.toMatchObject({ userId: member.userId, role: "staff" });
  });

  it("rolls back disabling if session revocation fails", async () => {
    const member = await service.create(credentials.admin, details);
    const headers = await login(details.email);
    await database.db.execute(sql`CREATE FUNCTION reject_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
    await database.db.execute(sql`CREATE TRIGGER simulate_revoke_failure BEFORE DELETE ON staff_auth.session FOR EACH ROW EXECUTE FUNCTION reject_session_delete()`);
    try {
      expect((await handle(request("PATCH", credentials.admin, { userId: member.userId, active: false }))).status).toBe(503);
      await expect(identity.access.requireClinicAccess(headers)).resolves.toMatchObject({ userId: member.userId });
      expect((await service.list(credentials.admin)).find((entry) => entry.userId === member.userId)?.active).toBe(true);
    } finally {
      await database.db.execute(sql`DROP TRIGGER simulate_revoke_failure ON staff_auth.session`);
      await database.db.execute(sql`DROP FUNCTION reject_session_delete()`);
    }
  });

  it.each([true, false])("cannot change the admin or an unknown identity to active=%s", async (active) => {
    for (const userId of [adminId, randomUUID()]) expect((await handle(request("PATCH", credentials.admin, { userId, active }))).status).toBe(404);
    await expect(identity.access.requireAdminAccess(credentials.admin)).resolves.toMatchObject({ userId: adminId });
  });

  it("new staff can use requested localhost 0000 codes but cannot use PIN or gain admin access", async () => {
    const member = await service.create(credentials.admin, details);
    const auth = createStaffAuthHandler(() => identity.staff, () => baseURL);
    const post = (path: string, body: object) => auth(new Request(`${baseURL}/api/auth/staff/${path}`, {
      method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect((await post("sign-in/admin-pin", { email: details.email, pin: "0000" })).status).toBe(401);
    expect((await post("sign-in/email-otp", { email: details.email, otp: "0000" })).status).toBeGreaterThanOrEqual(400);
    expect((await post("email-otp/send-verification-otp", { email: details.email, type: "sign-in" })).status).toBe(200);
    const headers = sessionHeaders(await post("sign-in/email-otp", { email: details.email, otp: "0000" }));
    await expect(identity.access.requireClinicAccess(headers)).resolves.toMatchObject({ userId: member.userId, role: "staff" });
    await expect(service.list(headers)).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
});

describe("staff endpoint authorization and validation", () => {
  it.each([["anonymous", 401], ["staff", 403], ["patient", 401]] as const)("rejects %s list/create/status requests despite forged role headers", async (role, status) => {
    const headers = new Headers(credentials[role]); headers.set("x-user-role", "admin"); headers.set("x-user-id", adminId);
    for (const [method, body] of [["GET", undefined], ["POST", details], ["PATCH", { userId: fixedStaffId, active: false }]] as const) {
      const response = await handle(request(method, headers, body)); expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(await service.list(credentials.admin)).toHaveLength(1);
  });

  it("returns only the member/list with private responses", async () => {
    const response = await handle(request("POST", credentials.admin, details));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    const { member } = await response.json();
    expect(Object.keys(member).sort()).toEqual(["active", "email", "name", "userId"]);
    const listed = await handle(request("GET"));
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.json()).toEqual({ staff: await service.list(credentials.admin) });
  });

  it.each([
    { ...details, name: " " }, { ...details, name: "a".repeat(121) }, { ...details, email: "invalid" },
    { ...details, role: "admin" }, { ...details, active: false }, { ...details, userId: "forged" },
  ])("rejects invalid or forged creation fields: %j", async (body) => {
    expect((await handle(request("POST", credentials.admin, body))).status).toBe(400);
    expect(await service.list(credentials.admin)).toHaveLength(1);
  });

  it.each([{ userId: "", active: false }, { userId: "x", active: "false" }, { userId: "x", active: false, role: "admin" }])("rejects invalid status updates: %j", async (body) => {
    expect((await handle(request("PATCH", credentials.admin, body))).status).toBe(400);
  });

  it("rejects missing/forged origins, malformed JSON and unsupported methods", async () => {
    for (const method of ["POST", "PATCH"]) for (const origin of ["", "https://other.example.test"]) {
      expect((await handle(request(method, credentials.admin, details, origin))).status).toBe(403);
    }
    const malformed = request("POST", credentials.admin, details);
    expect((await handle(new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" }))).status).toBe(400);
    expect((await handle(request("DELETE"))).status).toBe(405);
    expect(await service.list(credentials.admin)).toHaveLength(1);
  });

  it.each(["disabled", "revoked", "expired"])("rejects an admin session that becomes %s", async (state) => {
    const headers = sessionHeaders(await identity.staff.api.signInAdminPin({ body: { email: adminEmail, pin: "4821" }, asResponse: true }));
    const principal = await identity.access.requireAdminAccess(headers);
    if (state === "disabled") await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, adminId));
    else if (state === "revoked") await database.db.delete(staffSession).where(eq(staffSession.id, principal.sessionId));
    else await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.id, principal.sessionId));
    try {
      for (const [method, body] of [["GET", undefined], ["POST", details], ["PATCH", { userId: fixedStaffId, active: false }]] as const) {
        expect((await handle(request(method, headers, body))).status).toBe(state === "disabled" ? 403 : 401);
      }
    } finally { await database.db.update(staffAccess).set({ active: true }).where(eq(staffAccess.userId, adminId)); }
  });

  it.each(["revoked", "expired"])("rechecks a %s admin session after waiting for the edit lock", async (state) => {
    const headers = sessionHeaders(await identity.staff.api.signInAdminPin({ body: { email: adminEmail, pin: "4821" }, asResponse: true }));
    const principal = await identity.access.requireAdminAccess(headers);
    const blocker = await database.pool.connect(); let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT user_id FROM staff_access WHERE user_id = $1 FOR UPDATE", [adminId]);
      pending = handle(request("POST", headers, details));
      await expect.poll(async () => {
        const waiting = await database.db.execute(sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
        return Number(waiting.rows[0].count);
      }).toBeGreaterThan(0);
      if (state === "revoked") await database.db.delete(staffSession).where(and(eq(staffSession.id, principal.sessionId), eq(staffSession.userId, adminId)));
      // Expire after the waiting transaction began: CURRENT_TIMESTAMP would still be stale.
      else await database.db.update(staffSession).set({ expiresAt: sql`clock_timestamp()` }).where(eq(staffSession.id, principal.sessionId));
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(401);
      expect(await service.list(credentials.admin)).toHaveLength(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => {}); }
  });
});
