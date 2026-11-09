import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createDatabase } from "@/db/connection";
import { appointments, bookingAudit, bookingRequests } from "@/db/schema/booking";
import { clinicSettings, doctorProfile } from "@/db/schema/clinic";
import { patientSession, patientUser, patientVerification, staffAccess, staffSession, staffUser } from "@/db/schema/auth";
import { reservations } from "@/db/schema/scheduling";
import { createIdentity } from "@/modules/identity/create-auth";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import { createPatientAuthHandler } from "@/modules/identity/patient-http";
import { createPatientAppointmentsHandler, createPatientAppointmentsService } from "@/modules/booking/patient-appointments";
import { unconfiguredMailer, type LoginCode } from "@/platform/mail";

const baseURL = "http://localhost:3000", email = "same-email@example.test";
const patientId = randomUUID(), otherId = randomUUID();
const staffSecret = "patient-task-staff-" + "b".repeat(48), patientSecret = "patient-task-patient-" + "a".repeat(48);
let database: ReturnType<typeof createDatabase>, identity: ReturnType<typeof createIdentity>;
let service: ReturnType<typeof createPatientAppointmentsService>, handle: ReturnType<typeof createPatientAuthHandler>;
let originalPatientSessions: (typeof patientSession.$inferSelect)[], originalStaffSessions: (typeof staffSession.$inferSelect)[];
let adminId: string, clientNumber = 0;
const headers: Record<string, Headers> = { anonymous: new Headers() };
const mailbox: LoginCode[] = [];

function request(action: string, body: object = {}, cookie = new Headers(), origin = baseURL, method = "POST") {
  const copy = new Headers(cookie); copy.set("origin", origin); copy.set("content-type", "application/json"); copy.set("x-forwarded-for", `192.0.2.${clientNumber}`);
  return new Request(`${baseURL}/api/auth/patient/${action}`, { method, headers: copy, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
function sessionHeaders(response: Response) {
  expect(response.status).toBe(200);
  return new Headers({ cookie: response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ") });
}
async function patientLogin(address: string) {
  expect((await handle(request("email-otp/send-verification-otp", { email: address, type: "sign-in" }))).status).toBe(200);
  return sessionHeaders(await handle(request("sign-in/email-otp", { email: address, otp: "0000" })));
}
async function appointment(userId: string | null, start: string, status: typeof appointments.$inferInsert.status = "confirmed") {
  const startsAt = new Date(start), endsAt = new Date(startsAt.getTime() + 20 * 60_000);
  const [reservation] = await database.db.insert(reservations).values({ doctorId: 1, kind: "appointment", startsAt, endsAt }).returning();
  const [row] = await database.db.insert(appointments).values({ doctorId: 1, reservationId: reservation.id,
    patientUserId: userId, createdByStaffId: userId ? null : adminId, source: userId ? "patient" : "clinic", status,
    contactCiphertext: "protected-contact-must-not-be-returned", startsAt, endsAt, timezone: "Asia/Kolkata", durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }).returning();
  return row;
}
beforeAll(async () => {
  const url = new URL(inject("databaseUrl")), client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE patient_test"); } finally { await client.end(); }
  url.pathname = "/patient_test"; database = createDatabase(url.toString());
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  await bootstrapAdmin(database.db, { email, name: "Synthetic Doctor", pin: "4821", staffSecret });
  adminId = (await database.db.select().from(staffAccess))[0].userId;
  const staffId = randomUUID(); await database.db.insert(staffUser).values({ id: staffId, name: "Staff", email: "staff@example.test" });
  await database.db.insert(staffAccess).values({ userId: staffId, role: "staff" });
  await database.db.insert(patientUser).values([{ id: patientId, name: "Patient", email }, { id: otherId, name: "Other", email: "other@example.test" }]);
  identity = createIdentity({ db: database.db, baseURL, testMode: true, staffSecret, patientSecret, mailer: unconfiguredMailer });
  handle = createPatientAuthHandler(() => identity.patient, () => baseURL);
  headers.patient = await patientLogin(email); headers.other = await patientLogin("other@example.test");
  headers.admin = sessionHeaders(await identity.staff.api.signInAdminPin({ body: { email, pin: "0000" }, asResponse: true }));
  await identity.staff.api.sendVerificationOTP({ body: { email: "staff@example.test", type: "sign-in" } });
  headers.staff = sessionHeaders(await identity.staff.api.signInEmailOTP({ body: { email: "staff@example.test", otp: "0000" }, asResponse: true }));
  originalPatientSessions = await database.db.select().from(patientSession); originalStaffSessions = await database.db.select().from(staffSession);
  service = createPatientAppointmentsService(database.db, identity.patientAccess, () => new Date("2026-11-09T08:00Z"));
});
beforeEach(async () => {
  clientNumber++; mailbox.length = 0;
  await database.db.delete(bookingRequests); await database.db.delete(bookingAudit); await database.db.delete(appointments); await database.db.delete(clinicSettings);
  await database.db.delete(patientSession); await database.db.insert(patientSession).values(originalPatientSessions);
  await database.db.delete(staffSession); await database.db.insert(staffSession).values(originalStaffSessions);
  await database.db.update(patientUser).set({ emailVerified: true });
  await database.db.insert(clinicSettings).values({ id: 1, name: "Test Clinic", timezone: "UTC" });
  await database.db.insert(doctorProfile).values({ id: 1, name: "Doctor" });
});
afterAll(async () => { await database?.pool.end(); });

describe("patient appointment ownership", () => {
  it("returns only linked bookings, without requiring the contact-encryption key", async () => {
    const own = await appointment(patientId, "2026-11-10T09:00Z");
    await appointment(otherId, "2026-11-10T09:20Z"); await appointment(null, "2026-11-10T09:40Z");
    const response = await createPatientAppointmentsHandler(() => service)(new Request(`${baseURL}/api/patient/appointments?userId=${otherId}`, { headers: headers.patient }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ appointments: [{ id: own.id, startsAt: "2026-11-10T09:00:00.000Z", endsAt: "2026-11-10T09:20:00.000Z", timezone: "Asia/Kolkata", status: "confirmed" }] });
    expect((await service.list(headers.other)).map((row) => row.id)).not.toContain(own.id);
  });
  it("shows an empty list without claiming unlinked bookings or creating records", async () => {
    await appointment(null, "2026-11-10T09:00Z");
    expect(await service.view(headers.patient)).toEqual({ total: 0, upcoming: [], history: [] });
    expect(await database.db.select().from(appointments)).toHaveLength(1);
  });
  it("groups upcoming visits and history using current status and saved visit times", async () => {
    const past = await appointment(patientId, "2026-11-08T09:00Z", "completed");
    const upcoming = await appointment(patientId, "2026-11-10T09:00Z");
    const cancelled = await appointment(patientId, "2026-11-11T09:00Z", "cancelled");
    const missed = await appointment(patientId, "2026-11-07T09:00Z", "no_show");
    const view = await service.view(headers.patient);
    expect(view.upcoming.map((row) => row.id)).toEqual([upcoming.id]);
    expect(view.history.map((row) => row.id)).toEqual([cancelled.id, past.id, missed.id]);
    await database.db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, upcoming.id));
    expect((await service.view(headers.patient)).upcoming).toHaveLength(0);
  });
  it.each(["anonymous", "admin", "staff"])("rejects %s cookies instead of inferring a patient from email", async (role) => {
    const response = await createPatientAppointmentsHandler(() => service)(new Request(`${baseURL}/api/patient/appointments`, { headers: headers[role] }));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(identity.access.requireClinicAccess(headers.patient)).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each(["expired", "revoked", "unverified"])("rejects a previously valid patient after it becomes %s", async (state) => {
    await service.list(headers.patient);
    if (state === "expired") await database.db.update(patientSession).set({ expiresAt: new Date(0) }).where(eq(patientSession.userId, patientId));
    if (state === "revoked") await database.db.delete(patientSession).where(eq(patientSession.userId, patientId));
    if (state === "unverified") await database.db.update(patientUser).set({ emailVerified: false }).where(eq(patientUser.id, patientId));
    await expect(service.list(headers.patient)).rejects.toMatchObject({ statusCode: 401 });
  });
  it("rejects writes and returns a redacted retryable database failure", async () => {
    const handle = createPatientAppointmentsHandler(() => { throw new Error("private diagnostic"); });
    expect((await handle(new Request(`${baseURL}/api/patient/appointments`, { method: "POST" }))).status).toBe(405);
    const failure = await handle(new Request(`${baseURL}/api/patient/appointments`));
    expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("private diagnostic");
  });
});

describe("patient email-code HTTP boundary", () => {
  it("returns cookies but omits auth tokens/user records from successful sign-in", async () => {
    await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }));
    const response = await handle(request("sign-in/email-otp", { email, otp: "0000" }));
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.getSetCookie().join(";")).toContain("nuvortiq-patient.session_token");
    expect(response.headers.getSetCookie().join(";")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("requires a fresh code and rejects expiry/reuse with clear generic feedback", async () => {
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBeGreaterThanOrEqual(400);
    await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }));
    for (const record of await database.db.select().from(patientVerification)) {
      if (record.identifier.includes(email)) await database.db.update(patientVerification).set({ expiresAt: new Date(0) }).where(eq(patientVerification.id, record.id));
    }
    const expired = await handle(request("sign-in/email-otp", { email, otp: "0000" }));
    expect(expired.status).toBeGreaterThanOrEqual(400); expect(await expired.text()).toContain("invalid or expired");
    await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }));
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBe(200);
    clientNumber++;
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBeGreaterThanOrEqual(400);
  });
  it("preserves code attempt limits and can request a fresh code", async () => {
    await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }));
    for (let i = 0; i < 3; i++) expect((await handle(request("sign-in/email-otp", { email, otp: "1111" }))).status).toBeGreaterThanOrEqual(400);
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBeGreaterThanOrEqual(400);
    await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }));
    // A fresh code does not reset per-client HTTP limits. A separate client can verify it.
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBe(429);
    clientNumber++;
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBe(200);
  });
  it("creates a new local patient only after a requested code is verified and reuses that account later", async () => {
    const unknown = "new-local@example.test";
    const users = () => database.db.select().from(patientUser).where(eq(patientUser.email, unknown));
    expect((await handle(request("sign-in/email-otp", { email: unknown, otp: "0000" }))).status).toBeGreaterThanOrEqual(400);
    expect(await users()).toHaveLength(0);
    expect((await handle(request("email-otp/send-verification-otp", { email: unknown, type: "sign-in" }))).status).toBe(200);
    expect(await users()).toHaveLength(0);
    expect((await handle(request("sign-in/email-otp", { email: unknown, otp: "1111" }))).status).toBeGreaterThanOrEqual(400);
    expect(await users()).toHaveLength(0);
    const response = await handle(request("sign-in/email-otp", { email: unknown, otp: "0000" }));
    const signedIn = sessionHeaders(response);
    const [created] = await users(); expect(created.emailVerified).toBe(true);
    expect(await service.list(signedIn)).toEqual([]);
    expect(await database.db.select().from(staffUser).where(eq(staffUser.email, unknown))).toHaveLength(0);
    clientNumber++;
    await handle(request("email-otp/send-verification-otp", { email: unknown, type: "sign-in" }));
    expect((await handle(request("sign-in/email-otp", { email: unknown, otp: "0000" }))).status).toBe(200);
    expect((await users()).map((row) => row.id)).toEqual([created.id]);
  });
  it("keeps the latest requested code usable when further code requests are rate limited", async () => {
    for (let i = 0; i < 3; i++) expect((await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }))).status).toBe(200);
    expect((await handle(request("email-otp/send-verification-otp", { email, type: "sign-in" }))).status).toBe(429);
    expect((await handle(request("sign-in/email-otp", { email, otp: "0000" }))).status).toBe(200);
  });
  it("registers a normal-mode patient only after correct email verification, using in-memory mail", async () => {
    const address = "new-normal@example.test";
    const normal = createIdentity({ db: database.db, baseURL, staffSecret, patientSecret, mailer: { ...unconfiguredMailer, async sendPatientLoginCode(message) { mailbox.push(message); } } });
    const normalHandle = createPatientAuthHandler(() => normal.patient, () => baseURL);
    expect((await normalHandle(request("email-otp/send-verification-otp", { email: address, type: "sign-in" }))).status).toBe(200);
    expect(await database.db.select().from(patientUser).where(eq(patientUser.email, address))).toHaveLength(0);
    const code = mailbox.at(-1)!.code;
    expect((await normalHandle(request("sign-in/email-otp", { email: address, otp: code === "111111" ? "222222" : "111111" }))).status).toBeGreaterThanOrEqual(400);
    expect(await database.db.select().from(patientUser).where(eq(patientUser.email, address))).toHaveLength(0);
    const response = await normalHandle(request("sign-in/email-otp", { email: address, otp: code }));
    const patient = sessionHeaders(response);
    expect(await normal.patientAccess.requirePatientAccess(patient)).toBeDefined();
    expect((await database.db.select().from(patientUser).where(eq(patientUser.email, address)))[0].emailVerified).toBe(true);
    expect(await database.db.select().from(staffUser).where(eq(staffUser.email, address))).toHaveLength(0);
  });
  it("fails safely when real mail is not configured", async () => {
    const normal = createIdentity({ db: database.db, baseURL, staffSecret, patientSecret, mailer: unconfiguredMailer });
    const response = await createPatientAuthHandler(() => normal.patient, () => baseURL, () => false)(request("email-otp/send-verification-otp", { email: "no-mail@example.test", type: "sign-in" }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("not configured");
    expect(await database.db.select().from(patientUser).where(eq(patientUser.email, "no-mail@example.test"))).toHaveLength(0);
  });
  it("replaces an unexpired code on resend, rather than leaving multiple old records", async () => {
    const address = "resend-normal@example.test";
    const normal = createIdentity({ db: database.db, baseURL, staffSecret, patientSecret, mailer: { ...unconfiguredMailer, async sendPatientLoginCode(message) { mailbox.push(message); } } });
    const normalHandle = createPatientAuthHandler(() => normal.patient, () => baseURL);
    await normalHandle(request("email-otp/send-verification-otp", { email: address, type: "sign-in" }));
    const old = (await database.db.select().from(patientVerification)).find((record) => record.identifier.includes(address))!;
    await normalHandle(request("email-otp/send-verification-otp", { email: address, type: "sign-in" }));
    const records = (await database.db.select().from(patientVerification)).filter((record) => record.identifier.includes(address));
    expect(records).toHaveLength(1); expect(records[0].id).not.toBe(old.id);
    expect((await normalHandle(request("sign-in/email-otp", { email: address, otp: mailbox.at(-1)!.code }))).status).toBe(200);
  });
  it("keeps both cookies independent when signing out in either area", async () => {
    const both = new Headers({ cookie: `${headers.patient.get("cookie")}; ${headers.admin.get("cookie")}` });
    expect((await handle(request("sign-out", {}, both))).status).toBe(200);
    await expect(identity.patientAccess.requirePatientAccess(both)).rejects.toMatchObject({ statusCode: 401 });
    await expect(identity.access.requireAdminAccess(both)).resolves.toBeDefined();
    const patient = await patientLogin(email);
    const combined = new Headers({ cookie: `${patient.get("cookie")}; ${headers.admin.get("cookie")}` });
    await identity.staff.api.signOut({ headers: combined });
    await expect(identity.patientAccess.requirePatientAccess(combined)).resolves.toBeDefined();
    await expect(identity.access.requireAdminAccess(combined)).rejects.toMatchObject({ statusCode: 401 });
  });
  it("rejects unapproved auth paths, wrong origins/methods and malformed bodies", async () => {
    for (const action of ["get-session", "sign-in/admin-pin", "sign-in/email", "sign-up/email", "email-otp/verify-email", "email-otp/send-verification-otp/extra"]) {
      expect((await handle(request(action))).status).toBe(404);
    }
    expect((await handle(request("sign-out", {}, headers.patient, "https://elsewhere.example"))).status).toBe(403);
    expect((await handle(request("sign-out", {}, headers.patient, baseURL, "GET"))).status).toBe(405);
    for (const body of [{ email: "invalid", type: "sign-in" }, { email, type: "email-verification" }, { email, type: "sign-in", role: "admin" }]) {
      expect((await handle(request("email-otp/send-verification-otp", body))).status).toBe(400);
    }
  });
});
