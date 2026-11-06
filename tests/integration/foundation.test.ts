import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hashPassword } from "better-auth/crypto";
import { createDatabase } from "@/db/connection";
import { patientUser, patientVerification, staffUser, staffAccount } from "@/db/schema/auth";
import { createIdentity } from "@/modules/identity/create-auth";
import type { PatientLoginCode } from "@/platform/mail";

const baseURL = "http://localhost:3000";
const staffEmail = "doctor@example.test";
const password = "synthetic-test-password-only";
const mailbox: PatientLoginCode[] = [];
let database: ReturnType<typeof createDatabase>;
let identity: ReturnType<typeof createIdentity>;

function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function patientLogin(email: string) {
  await identity.patient.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const code = mailbox.findLast((message) => message.email === email)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const response = await identity.patient.api.signInEmailOTP({ body: { email, otp: code! }, asResponse: true });
  expect(response.status).toBe(200);
  return { response, code: code! };
}

beforeAll(async () => {
  database = createDatabase(inject("databaseUrl"));
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  identity = createIdentity({
    db: database.db, baseURL,
    patientSecret: "patient-integration-secret-" + "a".repeat(32),
    staffSecret: "staff-integration-secret-" + "b".repeat(32),
    mailer: { async sendPatientLoginCode(message) { mailbox.push(message); } },
  });
  const id = randomUUID();
  await database.db.insert(staffUser).values({ id, name: "Synthetic Doctor", email: staffEmail, emailVerified: true });
  await database.db.insert(staffAccount).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(password) });
});

afterAll(async () => { await database?.pool.end(); });

describe("PostgreSQL and migration feasibility", () => {
  it("connects to real PostgreSQL 17 and applies migration history idempotently", async () => {
    const version = await database.db.execute(sql`select current_setting('server_version_num')::int as version`);
    expect(Number(version.rows[0].version)).toBeGreaterThanOrEqual(170000);
    await expect(migrate(database.db, { migrationsFolder: "./drizzle" })).resolves.toBeUndefined();
    const tables = await database.db.execute(sql`select table_schema, table_name from information_schema.tables where table_schema in ('patient_auth', 'staff_auth')`);
    expect(tables.rows).toHaveLength(8);
  });
  it("rolls back failed transactions without persisting a partial identity", async () => {
    const id = randomUUID();
    await expect(database.db.transaction(async (tx) => {
      await tx.insert(patientUser).values({ id, name: "Rollback", email: "rollback@example.test" });
      throw new Error("simulated transaction failure");
    })).rejects.toThrow("simulated transaction failure");
    expect(await database.db.select().from(patientUser).where(eq(patientUser.id, id))).toHaveLength(0);
  });
});

describe("authentication boundaries", () => {
  it("authenticates patients by a single-use code without creating staff access", async () => {
    const email = "patient@example.test";
    const { response, code } = await patientLogin(email);
    const session = await identity.patient.api.getSession({ headers: new Headers({ cookie: cookies(response) }) });
    expect(session?.user.email).toBe(email);
    expect(await database.db.select().from(staffUser).where(eq(staffUser.email, email))).toHaveLength(0);
    const replay = await identity.patient.api.signInEmailOTP({ body: { email, otp: code }, asResponse: true });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });
  it("rejects an expired code and never stores its plaintext", async () => {
    const email = "expired@example.test";
    await identity.patient.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = mailbox.findLast((message) => message.email === email)!.code;
    const records = await database.db.select().from(patientVerification);
    const record = records.find((value) => value.identifier.includes(email))!;
    expect(record).toBeDefined();
    expect(record.value.split(":")[0]).not.toBe(code);
    await database.db.update(patientVerification).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(patientVerification.id, record.id));
    const response = await identity.patient.api.signInEmailOTP({ body: { email, otp: code }, asResponse: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("keeps same-email patient and staff cookies and identities separate in both directions", async () => {
    const { response: patientResponse } = await patientLogin(staffEmail);
    const patientCookie = cookies(patientResponse);
    expect(patientCookie).toContain("nuvortiq-patient");
    expect(await identity.staff.api.getSession({ headers: new Headers({ cookie: patientCookie }) })).toBeNull();

    const staffResponse = await identity.staff.api.signInEmail({ body: { email: staffEmail, password }, asResponse: true });
    expect(staffResponse.status).toBe(200);
    const staffCookie = cookies(staffResponse);
    expect(staffCookie).toContain("nuvortiq-staff");
    expect(await identity.patient.api.getSession({ headers: new Headers({ cookie: staffCookie }) })).toBeNull();
    const staffSession = await identity.staff.api.getSession({ headers: new Headers({ cookie: staffCookie }) });
    expect(staffSession?.user.email).toBe(staffEmail);
    const stored = await database.db.select().from(staffAccount);
    expect(stored[0].password).not.toBe(password);
  });
  it("invalidates a login code after too many incorrect attempts", async () => {
    const email = "attempts@example.test";
    await identity.patient.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const code = mailbox.findLast((message) => message.email === email)!.code;
    const wrongCode = code === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await identity.patient.api.signInEmailOTP({ body: { email, otp: wrongCode }, asResponse: true });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const response = await identity.patient.api.signInEmailOTP({ body: { email, otp: code }, asResponse: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("rejects incorrect staff passwords", async () => {
    const response = await identity.staff.api.signInEmail({ body: { email: staffEmail, password: "wrong-password" }, asResponse: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("disables public staff signup and staff OTP login", async () => {
    const signup = await identity.staff.handler(new Request(`${baseURL}/api/auth/staff/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "intruder@example.test", name: "Intruder", password }),
    }));
    expect(signup.status).toBeGreaterThanOrEqual(400);
    const otp = await identity.staff.handler(new Request(`${baseURL}/api/auth/staff/sign-in/email-otp`, {
      method: "POST", headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: staffEmail, otp: "123456" }),
    }));
    expect(otp.status).toBe(404);
    expect(await database.db.select().from(staffUser).where(eq(staffUser.email, "intruder@example.test"))).toHaveLength(0);
  });
  it("disables patient password signup", async () => {
    const response = await identity.patient.handler(new Request(`${baseURL}/api/auth/patient/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify({ email: "password-patient@example.test", name: "Patient", password }),
    }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
