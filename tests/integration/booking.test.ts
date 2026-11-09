import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@/db/connection";
import { appointments, bookingAudit, bookingRequests } from "@/db/schema/booking";
import { clinicSettings } from "@/db/schema/clinic";
import { patientSession, patientUser, staffAccess, staffSession, staffUser } from "@/db/schema/auth";
import { reservations } from "@/db/schema/scheduling";
import { emptyConfiguration } from "@/modules/clinic/configuration";
import { createClinicService } from "@/modules/clinic/service";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import { createIdentity } from "@/modules/identity/create-auth";
import { createSchedulingService } from "@/modules/scheduling/service";
import { createBookingService } from "@/modules/booking/service";
import { createPatientBookingAccess } from "@/modules/booking/access";
import { createContactProtection } from "@/modules/booking/contact-protection";
import { createHostedBookingService } from "@/modules/booking/hosted";
import { createHostedAvailabilityHandler, createPatientBookingHandler } from "@/modules/booking/hosted-http";
import { createPatientAppointmentsService } from "@/modules/booking/patient-appointments";
import { unconfiguredMailer } from "@/platform/mail";

const baseURL = "http://localhost:3000", date = "2026-11-10";
const adminEmail = "doctor@example.test", staffEmail = "staff@example.test";
const protection = createContactProtection(randomBytes(32).toString("base64"));
let database: ReturnType<typeof createDatabase>;
let identity: ReturnType<typeof createIdentity>;
let service: ReturnType<typeof createBookingService>;
let clinic: ReturnType<typeof createClinicService>;
let schedule: ReturnType<typeof createSchedulingService>;
let now: Date, adminId: string, staffId: string, patientId: string, otherPatientId: string;
let originalPatientSessions: (typeof patientSession.$inferSelect)[], originalStaffSessions: (typeof staffSession.$inferSelect)[];
const credentials: Record<string, Headers> = { anonymous: new Headers() };
const clock = () => now;
const bookingHandler = () => createPatientBookingHandler(() => service, () => baseURL);
const availabilityHandler = () => createHostedAvailabilityHandler(() => createHostedBookingService(database.db, identity.patientAccess, clock));
function httpRequest(path: string, role = "patient", body?: unknown, origin: string | null = baseURL, method = body === undefined ? "GET" : "POST") {
  const headers = new Headers(credentials[role]);
  if (origin !== null) headers.set("origin", origin);
  headers.set("content-type", "application/json");
  return new Request(`${baseURL}/api/patient/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function configuration() {
  const config = { ...emptyConfiguration(), clinicName: "Booking Test", doctorName: "Synthetic Doctor", timezone: "UTC", minLeadMinutes: 0 };
  config.weeklyHours.forEach((day) => { day.intervals = [{ start: "09:00", end: "12:00" }]; });
  return config;
}
function input(startsAt = `${date}T09:00:00Z`, requestId: string = randomUUID()) {
  return { requestId, startsAt, name: "Synthetic Patient", phone: "+91 98765 43210" };
}
function clinicInput(startsAt?: string, requestId?: string) { return { ...input(startsAt, requestId), email: adminEmail }; }
async function counts() {
  const tables = [appointments, reservations, bookingAudit, bookingRequests];
  return Promise.all(tables.map(async (table) => (await database.db.select({ count: sql<number>`count(*)::int` }).from(table))[0].count));
}
function cookies(response: Response) {
  expect(response.status).toBe(200);
  return new Headers({ cookie: response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; "), "x-user-role": "admin" });
}
beforeAll(async () => {
  const url = new URL(inject("databaseUrl")), client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE booking_test"); } finally { await client.end(); }
  url.pathname = "/booking_test"; database = createDatabase(url.toString());
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  const staffSecret = "booking-staff-" + "b".repeat(48);
  await bootstrapAdmin(database.db, { email: adminEmail, name: "Synthetic Doctor", pin: "4821", staffSecret });
  adminId = (await database.db.select().from(staffAccess).where(eq(staffAccess.role, "admin")))[0].userId;
  staffId = randomUUID(); patientId = randomUUID(); otherPatientId = randomUUID();
  await database.db.insert(staffUser).values({ id: staffId, name: "Synthetic Staff", email: staffEmail });
  await database.db.insert(staffAccess).values({ userId: staffId, role: "staff" });
  await database.db.insert(patientUser).values([{ id: patientId, name: "Same-email Patient", email: adminEmail },
    { id: otherPatientId, name: "Other Patient", email: "other@example.test" }]);
  identity = createIdentity({ db: database.db, baseURL, testMode: true, staffSecret, patientSecret: "booking-patient-" + "a".repeat(48), mailer: unconfiguredMailer });
  credentials.admin = cookies(await identity.staff.api.signInAdminPin({ body: { email: adminEmail, pin: "0000" }, asResponse: true }));
  for (const [role, email, boundary] of [["staff", staffEmail, "staff"], ["patient", adminEmail, "patient"], ["other", "other@example.test", "patient"]] as const) {
    await identity[boundary].api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    credentials[role] = cookies(await identity[boundary].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true }));
  }
  originalPatientSessions = await database.db.select().from(patientSession);
  originalStaffSessions = await database.db.select().from(staffSession);
  clinic = createClinicService(database.db, identity.access, clock);
  schedule = createSchedulingService(database.db, identity.access, clock);
  service = createBookingService(database.db, { ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient) }, protection, clock);
});
beforeEach(async () => {
  now = new Date("2026-11-09T08:00:00Z");
  await database.db.delete(bookingRequests); await database.db.delete(bookingAudit); await database.db.delete(appointments); await database.db.delete(clinicSettings);
  await database.db.delete(patientSession); await database.db.insert(patientSession).values(originalPatientSessions);
  await database.db.delete(staffSession); await database.db.insert(staffSession).values(originalStaffSessions);
  await database.db.update(staffAccess).set({ active: true });
  await database.db.update(patientUser).set({ emailVerified: true });
  await clinic.save(credentials.admin, configuration());
});
afterAll(async () => { await database?.pool.end(); });

describe("shared booking persistence", () => {
  it("replays migrations, retains the exclusion constraint and saves all records before confirming", async () => {
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    const constraints = await database.db.execute(sql`select conname from pg_constraint where conname = 'reservation_no_overlap'`);
    expect(constraints.rows).toHaveLength(1);
    const receipt = await service.bookPatient(credentials.patient, input());
    expect(receipt).toMatchObject({ status: "confirmed", startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T09:20:00.000Z`, durationMinutes: 20, timezone: "UTC" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
    const [appointment] = await database.db.select().from(appointments), [reservation] = await database.db.select().from(reservations);
    expect(appointment.patientUserId).toBe(patientId); expect(appointment.createdByStaffId).toBeNull();
    expect(appointment.reservationId).toBe(reservation.id);
    expect(protection.decrypt(appointment.id, appointment.contactCiphertext)).toEqual({ name: "Synthetic Patient", email: adminEmail, phone: "+919876543210" });
    expect(JSON.stringify(receipt)).not.toContain(adminEmail);
    expect(JSON.stringify(await database.db.select().from(bookingAudit))).not.toContain(adminEmail);
    expect((await schedule.calendar(credentials.admin, date, "day")).days[0].events.filter((event) => event.kind === "appointment")).toHaveLength(1);
    expect((await schedule.preview(credentials.admin, date)).slots).toHaveLength(8);
  });
  it.each(["admin", "staff"])("allows active %s booking without claiming a matching patient email", async (role) => {
    const receipt = await service.bookForClinic(credentials[role], clinicInput());
    const [appointment] = await database.db.select().from(appointments);
    expect(appointment.id).toBe(receipt.id); expect(appointment.patientUserId).toBeNull();
    expect(appointment.createdByStaffId).toBe(role === "admin" ? adminId : staffId);
    expect(appointment.source).toBe("clinic");
  });
  it("does not reserve anything when availability is only viewed", async () => {
    expect((await schedule.preview(credentials.admin, date)).slots).toHaveLength(9);
    await schedule.calendar(credentials.admin, date, "week");
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("enforces appointment ownership, duration and confirmed occupancy in PostgreSQL", async () => {
    const receipt = await service.bookPatient(credentials.patient, input());
    for (const change of [{ patientUserId: null }, { reservationId: null }, { durationMinutes: 30 }]) {
      await expect(database.db.update(appointments).set(change).where(eq(appointments.id, receipt.id))).rejects.toThrow();
    }
    const [appointment] = await database.db.select().from(appointments);
    await expect(database.db.delete(reservations).where(eq(reservations.id, appointment.reservationId!))).rejects.toThrow();
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("requires configured clinic settings", async () => {
    await database.db.delete(clinicSettings);
    await expect(service.bookPatient(credentials.patient, input())).rejects.toMatchObject({ code: "CLINIC_NOT_READY" });
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("snapshots buffers and timezone, keeps touching bookings valid and enforces DB non-overlap", async () => {
    const config = { ...configuration(), timezone: "Asia/Kolkata", bufferBeforeMinutes: 10, bufferAfterMinutes: 5 };
    await clinic.save(credentials.admin, config);
    const first = await service.bookPatient(credentials.patient, input(`${date}T09:10:00+05:30`));
    await service.bookForClinic(credentials.staff, clinicInput(`${date}T09:45:00+05:30`));
    const rows = await database.db.select().from(reservations).orderBy(reservations.startsAt);
    expect(first).toMatchObject({ startsAt: `${date}T03:40:00.000Z`, endsAt: `${date}T04:00:00.000Z`, bufferBeforeMinutes: 10, bufferAfterMinutes: 5, timezone: "Asia/Kolkata" });
    expect(rows[0].startsAt.toISOString()).toBe(`${date}T03:30:00.000Z`);
    expect(rows[0].endsAt).toEqual(rows[1].startsAt);
    await expect(database.db.insert(reservations).values({ doctorId: 1, kind: "appointment", startsAt: rows[0].startsAt, endsAt: rows[0].endsAt })).rejects.toThrow();
    await clinic.save(credentials.admin, { ...config, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect((await database.db.select().from(appointments))[0].durationMinutes).toBe(20);
    expect((await database.db.select().from(reservations)).find((row) => row.id === rows[0].id)).toEqual(rows[0]);
  });
  it("serializes competing patient/admin/staff bookings so exactly one commits", async () => {
    const results = await Promise.allSettled([service.bookPatient(credentials.patient, input()), service.bookForClinic(credentials.admin, clinicInput()), service.bookForClinic(credentials.staff, clinicInput())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((entry) => entry.status === "rejected")) expect(result.reason).toMatchObject({ statusCode: 409, code: "SLOT_UNAVAILABLE" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("allows simultaneous non-overlapping patient and clinic bookings", async () => {
    const results = await Promise.all([service.bookPatient(credentials.patient, input()), service.bookForClinic(credentials.staff, clinicInput(`${date}T09:20:00Z`))]);
    expect(results[0].id).not.toBe(results[1].id);
    expect(await counts()).toEqual([2, 2, 2, 2]);
  });
  it("maps a database exclusion failure to a safe conflict and rolls back", async () => {
    // Simulate a writer that bypasses the doctor lock after the availability read.
    await database.db.execute(sql`CREATE FUNCTION conflicting_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind = 'appointment' THEN INSERT INTO reservations (doctor_id, kind, starts_at, ends_at) VALUES (1, 'block', NEW.starts_at, NEW.ends_at); END IF;
      RETURN NEW; END $$`);
    await database.db.execute(sql`CREATE TRIGGER conflicting_reservation BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION conflicting_reservation()`);
    try {
      await expect(service.bookPatient(credentials.patient, input())).rejects.toMatchObject({ statusCode: 409, code: "SLOT_UNAVAILABLE" });
      expect(await counts()).toEqual([0, 0, 0, 0]);
    } finally {
      await database.db.execute(sql`DROP TRIGGER conflicting_reservation ON reservations`);
      await database.db.execute(sql`DROP FUNCTION conflicting_reservation()`);
    }
  });
  it("serializes identical retries and returns the original confirmation even after rules change", async () => {
    const value = clinicInput();
    const results = await Promise.all(Array.from({ length: 6 }, () => service.bookForClinic(credentials.staff, value)));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await counts()).toEqual([1, 1, 1, 1]);
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 40 });
    expect(await service.bookForClinic(credentials.staff, { ...value, startsAt: `${date}T14:30:00+05:30`, name: " Synthetic Patient ", email: " DOCTOR@example.test ", phone: "+919876543210" })).toEqual(results[0]);
  });
  it("rejects changed payloads and expired request keys without allocating another slot", async () => {
    const value = input(); await service.bookPatient(credentials.patient, value);
    for (const change of [{ name: "Other Name" }, { phone: "+919876543211" }, { startsAt: `${date}T09:20:00Z` }]) {
      await expect(service.bookPatient(credentials.patient, { ...value, ...change })).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
    }
    now = new Date("2026-11-10T08:00:00Z");
    await expect(service.bookPatient(credentials.patient, value)).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("scopes retry keys by authenticated actor and boundary", async () => {
    const value = input(); const original = await service.bookPatient(credentials.patient, value);
    await expect(service.bookPatient(credentials.other, value)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    const other = await service.bookPatient(credentials.other, { ...value, startsAt: `${date}T09:20:00Z` });
    const staff = await service.bookForClinic(credentials.admin, { ...clinicInput(`${date}T09:40:00Z`), requestId: value.requestId });
    expect(new Set([original.id, other.id, staff.id]).size).toBe(3);
    const owners = await database.db.select().from(appointments);
    expect(owners.find((row) => row.id === other.id)?.patientUserId).toBe(otherPatientId);
    expect(owners.find((row) => row.id === staff.id)?.patientUserId).toBeNull();
  });
  it.each([false, true])("rolls back every record on an injected %s-deferred database failure, allowing safe retry", async (deferred) => {
    await database.db.execute(sql`CREATE FUNCTION reject_booking_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic booking failure'; END $$`);
    await database.db.execute(sql.raw(deferred
      ? "CREATE CONSTRAINT TRIGGER reject_booking_receipt AFTER INSERT ON booking_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_booking_receipt()"
      : "CREATE TRIGGER reject_booking_receipt BEFORE INSERT ON booking_requests FOR EACH ROW EXECUTE FUNCTION reject_booking_receipt()"));
    const value = input();
    try {
      await expect(service.bookPatient(credentials.patient, value)).rejects.toThrow();
      expect(await counts()).toEqual([0, 0, 0, 0]);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_booking_receipt ON booking_requests`);
      await database.db.execute(sql`DROP FUNCTION reject_booking_receipt()`);
    }
    expect((await service.bookPatient(credentials.patient, value)).status).toBe("confirmed");
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
});

describe("authoritative booking checks", () => {
  it("rejects anonymous and wrong-boundary sessions even for the same email", async () => {
    for (const role of ["anonymous", "admin", "staff"]) await expect(service.bookPatient(credentials[role], input())).rejects.toMatchObject({ statusCode: 401 });
    for (const role of ["anonymous", "patient"]) await expect(service.bookForClinic(credentials[role], clinicInput())).rejects.toBeDefined();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("rejects forged ownership, role, email and duration fields", async () => {
    for (const extra of [{ patientUserId: otherPatientId }, { role: "admin" }, { email: "forged@example.test" }, { durationMinutes: 60 }]) {
      await expect(service.bookPatient(credentials.patient, { ...input(), ...extra })).rejects.toThrow();
    }
    await expect(service.bookForClinic(credentials.admin, { ...clinicInput(), patientUserId: patientId })).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("rejects disabled staff and revoked/expired/unverified patient sessions, including retries", async () => {
    const value = input(); await service.bookPatient(credentials.patient, value);
    await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, staffId));
    await expect(service.bookForClinic(credentials.staff, clinicInput(`${date}T09:20:00Z`))).rejects.toBeDefined();
    await database.db.update(patientUser).set({ emailVerified: false }).where(eq(patientUser.id, patientId));
    await expect(service.bookPatient(credentials.patient, value)).rejects.toMatchObject({ statusCode: 401 });
    await database.db.update(patientUser).set({ emailVerified: true }).where(eq(patientUser.id, patientId));
    await database.db.update(patientSession).set({ expiresAt: new Date(0) }).where(eq(patientSession.userId, patientId));
    await expect(service.bookPatient(credentials.patient, value)).rejects.toMatchObject({ statusCode: 401 });
    await database.db.delete(patientSession).where(eq(patientSession.userId, patientId));
    await expect(service.bookPatient(credentials.patient, value)).rejects.toMatchObject({ statusCode: 401 });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("rechecks staff access after waiting for the schedule lock", async () => {
    const blocker = await database.pool.connect();
    let passed!: () => void;
    const authenticated = new Promise<void>((resolve) => { passed = resolve; });
    const guarded = createBookingService(database.db, {
      requirePatientAccess: createPatientBookingAccess(identity.patient),
      async requireClinicAccess(headers) { const principal = await identity.access.requireClinicAccess(headers); passed(); return principal; },
    }, protection, clock);
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM doctor_profile WHERE id = 1 FOR UPDATE");
      pending = guarded.bookForClinic(credentials.staff, clinicInput());
      const rejected = expect(pending).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await authenticated;
      await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, staffId));
      await blocker.query("COMMIT");
      await rejected;
      expect(await counts()).toEqual([0, 0, 0, 0]);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => {}); }
  });
  it("rejects stale, closed, off-grid, occupied and past slots", async () => {
    const value = input(); expect((await schedule.preview(credentials.admin, date)).slots).toHaveLength(9);
    await schedule.addBreak(credentials.admin, { date, start: "09:00", end: "09:20" });
    await expect(service.bookPatient(credentials.patient, value)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(service.bookPatient(credentials.patient, input(`${date}T09:21:00Z`))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await schedule.saveOverride(credentials.admin, { date, mode: "closed" });
    await expect(service.bookPatient(credentials.patient, input(`${date}T10:00:00Z`))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(service.bookPatient(credentials.patient, input("2026-11-08T09:00:00Z"))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    expect(await counts()).toEqual([0, 1, 0, 0]);
  });
  it("applies minimum notice, horizon, special hours and changed duration at confirmation time", async () => {
    now = new Date(`${date}T08:30:00Z`);
    await clinic.save(credentials.admin, { ...configuration(), minLeadMinutes: 60, bookingHorizonDays: 1 });
    for (const start of [`${date}T09:20:00Z`, "2026-11-11T09:00:00Z"]) await expect(service.bookPatient(credentials.patient, input(start))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await schedule.saveOverride(credentials.admin, { date, mode: "custom", intervals: [{ start: "10:00", end: "11:00" }] });
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 30 });
    await expect(service.bookPatient(credentials.patient, input(`${date}T10:20:00Z`))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    expect((await service.bookPatient(credentials.patient, input(`${date}T10:00:00Z`))).endsAt).toBe(`${date}T10:30:00.000Z`);
  });
  it("preserves booked occupancy against holidays, shortened hours and overlapping breaks", async () => {
    await service.bookPatient(credentials.patient, input());
    await expect(schedule.saveOverride(credentials.admin, { date, mode: "closed" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(schedule.addBreak(credentials.admin, { date, start: "09:00", end: "09:20" })).rejects.toMatchObject({ statusCode: 409 });
    const config = configuration(); config.weeklyHours[1].intervals = [{ start: "10:00", end: "12:00" }];
    await expect(clinic.save(credentials.admin, config)).rejects.toMatchObject({ statusCode: 409 });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("serializes competing holiday and booking writes without an invalid appointment", async () => {
    const results = await Promise.allSettled([service.bookPatient(credentials.patient, input()), schedule.saveOverride(credentials.admin, { date, mode: "closed" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const view = await schedule.preview(credentials.admin, date);
    if (results[0].status === "fulfilled") { expect(view.override).toBeNull(); expect(await counts()).toEqual([1, 1, 1, 1]); }
    else { expect(view.override?.mode).toBe("closed"); expect(await counts()).toEqual([0, 0, 0, 0]); }
  });
  it.each(["2026-03-08", "2026-11-01"])("uses the existing DST-safe slot engine on %s", async (day) => {
    now = new Date(`${day}T00:00:00Z`);
    const config = { ...configuration(), timezone: "America/New_York" };
    config.weeklyHours.forEach((entry) => { entry.intervals = [{ start: "00:00", end: "05:00" }]; });
    await clinic.save(credentials.admin, config);
    const slots = (await schedule.preview(credentials.admin, day)).slots;
    expect(slots.length).toBeGreaterThan(0);
    const chosen = slots.at(-1)!;
    const receipt = await service.bookPatient(credentials.patient, input(chosen.startsAt));
    expect(receipt.endsAt).toBe(chosen.endsAt);
    expect(Date.parse(receipt.endsAt) - Date.parse(receipt.startsAt)).toBe(20 * 60_000);
    const ambiguousOrMissing = day === "2026-11-01" ? `${day}T05:20:00Z` : `${day}T07:10:00Z`;
    await expect(service.bookPatient(credentials.patient, input(ambiguousOrMissing))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });
  it("finds an earlier-date reservation crossing clinic midnight", async () => {
    const config = configuration(); config.weeklyHours[1].intervals = [{ start: "00:00", end: "01:00" }];
    await clinic.save(credentials.admin, config);
    await database.db.insert(reservations).values({ doctorId: 1, kind: "block", startsAt: new Date("2026-11-09T23:50Z"), endsAt: new Date(`${date}T00:20Z`) });
    await expect(service.bookPatient(credentials.patient, input(`${date}T00:00:00Z`))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    expect((await service.bookPatient(credentials.patient, input(`${date}T00:20:00Z`))).status).toBe("confirmed");
  });
});

describe("hosted patient booking HTTP", () => {
  it("distinguishes missing-key setup failure before a booking attempt and permits recovery", async () => {
    const notReady = createPatientBookingHandler(() => { createContactProtection(undefined); return service; }, () => baseURL);
    const response = await notReady(httpRequest("bookings", "patient", input()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "BOOKING_NOT_READY", error: "Online booking is temporarily unavailable. Please try again or contact the clinic." });
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect((await bookingHandler()(httpRequest("bookings", "patient", input()))).status).toBe(200);
  });
  it("allows tomorrow within the clinic window unless a saved closure replaces weekly hours", async () => {
    now = new Date("2026-11-09T15:30:00Z");
    await clinic.save(credentials.admin, { ...configuration(), timezone: "Asia/Kolkata", minLeadMinutes: 60, bookingHorizonDays: 15 });
    const read = async () => (await (await availabilityHandler()(httpRequest(`availability?date=${date}`))).json()).availability;
    const tomorrow = await read();
    expect(tomorrow).toMatchObject({ today: "2026-11-09", date, lastDate: "2026-11-24", closed: false });
    expect(tomorrow.slots[0].startsAt).toBe(`${date}T03:30:00.000Z`);
    await schedule.saveOverride(credentials.admin, { date, mode: "closed", reason: "private closure" });
    expect(await read()).toMatchObject({ closed: true, slots: [] });
    await schedule.saveOverride(credentials.admin, { date, mode: "weekly" });
    expect((await read()).slots).toEqual(tomorrow.slots);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("returns free visit times and verified email without internal occupancy or notes", async () => {
    await schedule.addBreak(credentials.admin, { date, start: "09:00", end: "09:20", reason: "private staff note" });
    await schedule.saveOverride(credentials.admin, { date, mode: "custom", intervals: [{ start: "09:00", end: "11:00" }], reason: "internal override note" });
    const response = await availabilityHandler()(httpRequest(`availability?date=${date}&patientUserId=${otherPatientId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Vary")).toBe("Cookie");
    const data = await response.json();
    expect(data.email).toBe(adminEmail);
    expect(data.availability).toMatchObject({ clinicName: "Booking Test", doctorName: "Synthetic Doctor", timezone: "UTC", date });
    expect(data.availability.slots).toEqual((await schedule.preview(credentials.admin, date)).slots.map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label })));
    for (const secret of ["private staff note", "internal override note", "occupiedStart", "blocks", "override", "patientUserId", patientId, "session", "token"]) expect(JSON.stringify(data)).not.toContain(secret);
    expect(await counts()).toEqual([0, 1, 0, 0]);
  });
  it.each(["anonymous", "admin", "staff"])("rejects %s cookies for availability and confirmation", async (role) => {
    for (const response of [await availabilityHandler()(httpRequest(`availability?date=${date}`, role)), await bookingHandler()(httpRequest("bookings", role, input()))]) {
      expect(response.status).toBe(401); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ code: "SIGN_IN_REQUIRED" });
    }
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each(["revoked", "expired", "unverified"])("rejects %s patients for reads, writes and successful-request retries", async (kind) => {
    const value = input(); expect((await bookingHandler()(httpRequest("bookings", "patient", value))).status).toBe(200);
    if (kind === "revoked") await database.db.delete(patientSession).where(eq(patientSession.userId, patientId));
    if (kind === "expired") await database.db.update(patientSession).set({ expiresAt: new Date(0) }).where(eq(patientSession.userId, patientId));
    if (kind === "unverified") await database.db.update(patientUser).set({ emailVerified: false }).where(eq(patientUser.id, patientId));
    expect((await availabilityHandler()(httpRequest(`availability?date=${date}`))).status).toBe(401);
    expect((await bookingHandler()(httpRequest("bookings", "patient", value))).status).toBe(401);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("checks trusted origin, method, JSON and strict booking fields", async () => {
    for (const origin of [null, "https://untrusted.example"]) expect((await bookingHandler()(httpRequest("bookings", "patient", input(), origin))).status).toBe(403);
    expect((await bookingHandler()(httpRequest("bookings"))).status).toBe(405);
    expect((await availabilityHandler()(httpRequest("availability", "patient", {}))).status).toBe(405);
    for (const extra of [{ email: "forged@example.test" }, { patientUserId: otherPatientId }, { role: "admin" }, { endsAt: `${date}T12:00:00Z` }, { phone: "123" }, { requestId: "invalid" }]) {
      expect((await bookingHandler()(httpRequest("bookings", "patient", { ...input(), ...extra }))).status).toBe(400);
    }
    const malformed = new Request(`${baseURL}/api/patient/bookings`, { method: "POST", headers: { cookie: credentials.patient.get("cookie")!, origin: baseURL, "Content-Type": "application/json" }, body: "{" });
    expect((await bookingHandler()(malformed)).status).toBe(400);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("commits one explicitly owned appointment and returns a private minimal receipt", async () => {
    const response = await bookingHandler()(httpRequest("bookings", "patient", input()));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { receipt } = await response.json();
    expect(receipt).toMatchObject({ status: "confirmed", startsAt: `${date}T09:00:00.000Z` });
    expect(JSON.stringify(receipt)).not.toContain(adminEmail); expect(JSON.stringify(receipt)).not.toContain("contact");
    const [saved] = await database.db.select().from(appointments);
    expect(saved.patientUserId).toBe(patientId);
    expect(protection.decrypt(saved.id, saved.contactCiphertext)).toEqual({ name: "Synthetic Patient", phone: "+919876543210", email: adminEmail });
    const listing = createPatientAppointmentsService(database.db, identity.patientAccess, clock);
    expect((await listing.list(credentials.patient)).map((row) => row.id)).toEqual([receipt.id]);
    expect(await listing.list(credentials.other)).toEqual([]);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("replays simultaneous confirmations and a lost-response retry even after slot rules change", async () => {
    const value = input();
    const responses = await Promise.all([bookingHandler()(httpRequest("bookings", "patient", value)), bookingHandler()(httpRequest("bookings", "patient", value))]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const data = await Promise.all(responses.map((response) => response.json())); expect(data[0]).toEqual(data[1]);
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 30 });
    expect(await (await bookingHandler()(httpRequest("bookings", "patient", value))).json()).toEqual(data[0]);
    expect((await bookingHandler()(httpRequest("bookings", "patient", { ...value, name: "Changed" }))).status).toBe(409);
    now = new Date(now.getTime() + 24 * 60 * 60_000);
    expect((await bookingHandler()(httpRequest("bookings", "patient", value))).status).toBe(409);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("competes with receptionist booking under the shared lock and refreshes only free times", async () => {
    const results = await Promise.allSettled([bookingHandler()(httpRequest("bookings", "patient", input())), service.bookForClinic(credentials.staff, clinicInput())]);
    const patient = results[0]; expect(patient.status).toBe("fulfilled");
    if (patient.status !== "fulfilled") return;
    if (patient.value.status === 200) expect(results[1].status).toBe("rejected");
    else { expect(patient.value.status).toBe(409); expect(await patient.value.json()).toMatchObject({ code: "SLOT_UNAVAILABLE" }); expect(results[1].status).toBe("fulfilled"); }
    const { availability } = await (await availabilityHandler()(httpRequest(`availability?date=${date}`))).json();
    expect(availability.slots.some((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00.000Z`)).toBe(false);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("reports closed dates, booking-window validation and an unconfigured clinic safely", async () => {
    for (const value of ["2026-02-30", "not-a-date", "2026-11-08", "2027-01-01"]) expect((await availabilityHandler()(httpRequest(`availability?date=${value}`))).status).toBe(400);
    await schedule.saveOverride(credentials.admin, { date, mode: "closed", reason: "private reason" });
    const closed = await (await availabilityHandler()(httpRequest(`availability?date=${date}`))).json();
    expect(closed.availability.slots).toEqual([]); expect(JSON.stringify(closed)).not.toContain("private reason");
    await database.db.delete(clinicSettings);
    expect((await (await availabilityHandler()(httpRequest("availability"))).json()).availability.configured).toBe(false);
    expect((await bookingHandler()(httpRequest("bookings", "patient", input()))).status).toBe(409);
  });
  it.each(["2026-03-08", "2026-11-01"])("matches admin slot rules and UTC instants across DST on %s", async (day) => {
    now = new Date(`${day}T00:00:00Z`);
    const config = { ...configuration(), timezone: "America/New_York", bufferBeforeMinutes: 5, bufferAfterMinutes: 5 };
    config.weeklyHours.forEach((entry) => { entry.intervals = [{ start: "00:00", end: "05:00" }]; });
    await clinic.save(credentials.admin, config);
    const { availability } = await (await availabilityHandler()(httpRequest(`availability?date=${day}`))).json();
    expect(availability.slots).toEqual((await schedule.preview(credentials.admin, day)).slots.map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label })));
    const chosen = availability.slots.at(-1);
    const response = await bookingHandler()(httpRequest("bookings", "patient", input(chosen.startsAt)));
    expect(response.status).toBe(200); expect((await response.json()).receipt.endsAt).toBe(chosen.endsAt);
  });
  it("redacts database failures, rolls back and can retry the same HTTP request", async () => {
    await database.db.execute(sql`CREATE FUNCTION fail_hosted_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'secret internal database detail'; END $$`);
    await database.db.execute(sql`CREATE TRIGGER fail_hosted_audit BEFORE INSERT ON booking_audit FOR EACH ROW EXECUTE FUNCTION fail_hosted_audit()`);
    const value = input();
    try {
      const response = await bookingHandler()(httpRequest("bookings", "patient", value));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret internal"); expect(await counts()).toEqual([0, 0, 0, 0]);
    } finally { await database.db.execute(sql`DROP TRIGGER fail_hosted_audit ON booking_audit`); await database.db.execute(sql`DROP FUNCTION fail_hosted_audit()`); }
    expect((await bookingHandler()(httpRequest("bookings", "patient", value))).status).toBe(200); expect(await counts()).toEqual([1, 1, 1, 1]);
  });
});
