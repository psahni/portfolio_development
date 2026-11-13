import { localBookingEmails } from "@/db/schema/notifications";
import { createPostBookingLocalEmail, localBookingEmailEnabled, localEmailBookingEvents } from "@/modules/notifications/local-booking-email";
import { whatsappAttempts, whatsappConsents, whatsappNotifications } from "@/db/schema/notifications";
import { whatsappBookingEvents } from "@/modules/notifications/booking-events";
import { createPostBookingWhatsApp } from "@/modules/notifications/post-booking";
import type { SendResult } from "@/modules/notifications/meta";
import { createWhatsAppDelivery } from "@/modules/notifications/delivery";
import { createWhatsAppConsentHandler } from "@/modules/notifications/consent";
import { vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
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
import { createPatientCancellationService } from "@/modules/booking/patient-cancellation";
import { createPatientCancellationHandler } from "@/modules/booking/patient-cancellation-http";
import { createDoctorAppointmentsService } from "@/modules/booking/doctor-appointments";
import { createDoctorAppointmentsHandler } from "@/modules/booking/doctor-http";
import { createClinicBookingAvailability } from "@/modules/booking/clinic-booking";
import { createClinicAvailabilityHandler, createClinicBookingHandler } from "@/modules/booking/clinic-booking-http";
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
let originalAdminPinHash: string;
let originalPatientSessions: (typeof patientSession.$inferSelect)[], originalStaffSessions: (typeof staffSession.$inferSelect)[];
const credentials: Record<string, Headers> = { anonymous: new Headers() };
const clock = () => now;
const bookingHandler = () => createPatientBookingHandler(() => service, () => baseURL);
const availabilityHandler = () => createHostedAvailabilityHandler(() => createHostedBookingService(database.db, identity.patientAccess, clock));
const cancellationService = () => createPatientCancellationService(database.db, identity.patientAccess, clock);
const cancellationHandler = () => createPatientCancellationHandler(cancellationService, () => baseURL);
const doctorService = () => createDoctorAppointmentsService(database.db, identity.access, () => protection, clock);
const doctorHandler = () => createDoctorAppointmentsHandler(doctorService, () => baseURL);
const doctorInput = (appointmentId: string, blockOriginalTime = false) => ({ appointmentId, reason: "Doctor unavailable", rebookingInstruction: "Please book another available time.", blockOriginalTime });
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
  originalAdminPinHash = (await database.db.select().from(staffAccess).where(eq(staffAccess.userId, adminId)))[0].adminPinHash!;
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
  await database.db.update(staffAccess).set({ role: "admin", adminPinHash: originalAdminPinHash }).where(eq(staffAccess.userId, adminId));
  await database.db.update(patientUser).set({ emailVerified: true });
  await clinic.save(credentials.admin, configuration());
});
afterAll(async () => { await database?.pool.end(); });

describe("patient daily booking limit", () => {
  it.each(["confirmed", "completed", "no_show"] as const)("counts %s visits without creating a partial second booking", async (status) => {
    const original = input(), first = await service.bookPatient(credentials.patient, original);
    await database.db.update(appointments).set({ status }).where(eq(appointments.id, first.id));
    await expect(service.bookPatient(credentials.patient, input(`${date}T09:20:00Z`))).rejects.toMatchObject({ statusCode: 409, code: "PATIENT_DAILY_LIMIT" });
    expect(await service.bookPatient(credentials.patient, original)).toEqual(first);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("serializes different-slot requests from the same patient", async () => {
    const results = await Promise.allSettled([service.bookPatient(credentials.patient, input()), service.bookPatient(credentials.patient, input(`${date}T09:20:00Z`))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "PATIENT_DAILY_LIMIT" } });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("allows cancel then book again, other patients, other dates and repeated staff bookings", async () => {
    const original = input(), first = await service.bookPatient(credentials.patient, original);
    await cancellationService().cancel(credentials.patient, { appointmentId: first.id });
    const next = await service.bookPatient(credentials.patient, input());
    expect(next.id).not.toBe(first.id);
    expect(await service.bookPatient(credentials.patient, original)).toEqual(first);
    await service.bookPatient(credentials.other, input(`${date}T09:20:00Z`));
    await service.bookPatient(credentials.patient, input("2026-11-11T09:00:00Z"));
    await service.bookForClinic(credentials.staff, clinicInput(`${date}T09:40:00Z`));
    await service.bookForClinic(credentials.staff, clinicInput(`${date}T10:00:00Z`));
    expect(await counts()).toEqual([6, 5, 7, 6]);
  });
  it("uses clinic dates across UTC midnight, allowing the next local date", async () => {
    const config = { ...configuration(), timezone: "Asia/Kolkata" };
    config.weeklyHours.forEach((d) => { d.intervals = [{ start: "00:00", end: "02:00" }, { start: "23:00", end: "23:59" }]; });
    await clinic.save(credentials.admin, config);
    await service.bookPatient(credentials.patient, input("2026-11-09T18:30:00Z"));
    await expect(service.bookPatient(credentials.patient, input("2026-11-10T17:30:00Z"))).rejects.toMatchObject({ code: "PATIENT_DAILY_LIMIT" });
    await service.bookPatient(credentials.patient, input("2026-11-10T18:30:00Z"));
    expect(await counts()).toEqual([2, 2, 2, 2]);
  });
  it.each(["2026-03-08", "2026-11-01"])("uses the full DST local date %s", async (day) => {
    now = new Date(new Date(`${day}T00:00Z`).getTime() - 86_400_000);
    const config = { ...configuration(), timezone: "America/New_York" };
    config.weeklyHours.forEach((d) => { d.intervals = [{ start: "00:00", end: "04:00" }]; });
    await clinic.save(credentials.admin, config);
    const slots = (await schedule.preview(credentials.admin, day)).slots;
    await service.bookPatient(credentials.patient, input(slots[0].startsAt));
    await expect(service.bookPatient(credentials.patient, input(slots.at(-1)!.startsAt))).rejects.toMatchObject({ code: "PATIENT_DAILY_LIMIT" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
});

describe("patient cancellation cooldown", () => {
  it("waits exactly three hours after two cancellations, then starts a new two-cancellation cycle", async () => {
    const firstInput = input(), first = await service.bookPatient(credentials.patient, firstInput);
    await cancellationService().cancel(credentials.patient, { appointmentId: first.id });
    now = new Date(now.getTime() + 60_000);
    const second = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: second.id });
    const secondCancelledAt = now.getTime();
    // Old cancellations had no dedicated metadata; their audit records remain usable.
    await database.db.update(appointments).set({ patientCancelledAt: null, patientCancellationLate: null }).where(eq(appointments.id, first.id));
    const rejected = await Promise.allSettled([service.bookPatient(credentials.patient, input()), service.bookPatient(credentials.patient, input(`${date}T09:20:00Z`))]);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) expect(result).toMatchObject({ status: "rejected", reason: { code: "PATIENT_CANCELLATION_COOLDOWN" } });
    expect(await service.bookPatient(credentials.patient, firstInput)).toEqual(first);
    await service.bookPatient(credentials.other, input(`${date}T09:20:00Z`));
    await service.bookForClinic(credentials.staff, clinicInput(`${date}T09:40:00Z`));
    await expect(service.bookPatient(credentials.patient, input("2026-11-11T09:00:00Z"))).rejects.toMatchObject({ code: "PATIENT_CANCELLATION_COOLDOWN" });
    now = new Date(secondCancelledAt + 3 * 60 * 60 * 1000 - 1);
    await expect(service.bookPatient(credentials.patient, input())).rejects.toMatchObject({ code: "PATIENT_CANCELLATION_COOLDOWN" });
    now = new Date(secondCancelledAt + 3 * 60 * 60 * 1000);
    await service.bookPatient(credentials.patient, input("2026-11-11T09:00:00Z"));
    const third = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: third.id });
    const fourth = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: fourth.id });
    await expect(service.bookPatient(credentials.patient, input())).rejects.toMatchObject({ code: "PATIENT_CANCELLATION_COOLDOWN" });
    expect(await counts()).toEqual([7, 3, 11, 7]);
  });
  it("counts cancellations on different dates toward the same patient cooldown", async () => {
    const first = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: first.id });
    const second = await service.bookPatient(credentials.patient, input("2026-11-11T09:00:00Z"));
    await cancellationService().cancel(credentials.patient, { appointmentId: second.id });
    await expect(service.bookPatient(credentials.patient, input("2026-11-12T09:00:00Z"))).rejects.toMatchObject({ code: "PATIENT_CANCELLATION_COOLDOWN" });
    expect(await counts()).toEqual([2, 0, 4, 2]);
  });
  it("extends the wait for older cancellation history that violated the new rule", async () => {
    const start = now.getTime(), ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const first = await service.bookPatient(credentials.patient, input());
      await cancellationService().cancel(credentials.patient, { appointmentId: first.id }); ids.push(first.id);
      // Create legacy history through the staff-exempt path, then link the patient
      // directly in the synthetic test to model data saved before enforcement.
      if (i === 1) break;
      now = new Date(now.getTime() + 60_000);
    }
    const legacy = await service.bookForClinic(credentials.staff, clinicInput());
    await doctorService().cancel(credentials.admin, doctorInput(legacy.id));
    await database.db.update(bookingAudit).set({ actorKind: "patient", actorId: patientId, createdAt: new Date(start + 2 * 60_000) }).where(and(eq(bookingAudit.appointmentId, legacy.id), eq(bookingAudit.action, "cancelled")));
    await database.db.update(appointments).set({ source: "patient", patientUserId: patientId, createdByStaffId: null, cancelledByStaffId: null, cancelledAt: null, cancellationReason: null, rebookingInstruction: null, originalTimeBlocked: false }).where(eq(appointments.id, legacy.id));
    now = new Date(start + 2 * 60_000 + 3 * 60 * 60 * 1000 - 1);
    await expect(service.bookPatient(credentials.patient, input())).rejects.toMatchObject({ code: "PATIENT_CANCELLATION_COOLDOWN" });
    now = new Date(now.getTime() + 1);
    expect((await service.bookPatient(credentials.patient, input())).status).toBe("confirmed");
  });
});

describe("doctor appointment list and basic cancellation", () => {
  it("lists minimal decrypted contacts and all statuses by clinic date, retaining cancelled history", async () => {
    const first = await service.bookPatient(credentials.patient, input());
    const second = await service.bookForClinic(credentials.staff, clinicInput(`${date}T09:20:00Z`));
    await doctorService().cancel(credentials.admin, doctorInput(first.id));
    const response = await doctorHandler()(httpRequest(`appointments?date=${date}`, "admin"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Vary")).toBe("Cookie");
    const data = await response.json();
    expect(data).toMatchObject({ configured: true, date, timezone: "UTC" });
    expect(data.appointments.map((a: { id: string }) => a.id)).toEqual([first.id, second.id]);
    expect(data.appointments[0]).toMatchObject({ status: "cancelled", canCancel: false, contact: { name: "Synthetic Patient", email: adminEmail, phone: "+919876543210" }, cancellation: { reason: "Doctor unavailable", originalTimeBlocked: false } });
    expect(data.appointments[1]).toMatchObject({ status: "confirmed", canCancel: true, cancellation: null });
    for (const value of ["contactCiphertext", "patientUserId", "cancelledByStaffId", "sessionId", "reservationId", "actorId"]) expect(JSON.stringify(data)).not.toContain(value);
    await database.db.update(appointments).set({ status: "no_show" }).where(eq(appointments.id, second.id));
    expect((await doctorService().view(credentials.admin, date)).appointments[1]).toMatchObject({ status: "no_show", canCancel: false });
    await database.db.update(appointments).set({ status: "completed" }).where(eq(appointments.id, second.id));
    expect((await doctorService().view(credentials.admin, date)).appointments[1]).toMatchObject({ status: "completed", canCancel: false });
    const patientList = await createPatientAppointmentsService(database.db, identity.patientAccess, clock).view(credentials.patient);
    expect(patientList.history[0].status).toBe("cancelled");
    expect(JSON.stringify(patientList)).not.toContain("Doctor unavailable");
  });
  it("selects the clinic-local start date with half-open midnight bounds", async () => {
    const config = { ...configuration(), timezone: "Asia/Kolkata" };
    config.weeklyHours.forEach((d) => { d.intervals = [{ start: "00:00", end: "02:00" }, { start: "23:00", end: "23:59" }]; });
    await clinic.save(credentials.admin, config);
    await service.bookPatient(credentials.patient, input("2026-11-09T17:30:00Z"));
    const midnight = await service.bookPatient(credentials.patient, input("2026-11-09T18:30:00Z"));
    await service.bookPatient(credentials.patient, input("2026-11-10T18:30:00Z"));
    expect((await doctorService().view(credentials.admin, date)).appointments.map((a) => a.id)).toEqual([midnight.id]);
    now = new Date("2026-11-09T19:00:00Z");
    expect((await doctorService().view(credentials.admin)).date).toBe(date);
  });
  it.each(["2026-03-08", "2026-11-01"])("lists bookings on the DST transition date %s", async (day) => {
    now = new Date(new Date(`${day}T00:00Z`).getTime() - 86_400_000);
    const config = { ...configuration(), timezone: "America/New_York" };
    config.weeklyHours.forEach((d) => { d.intervals = [{ start: "00:00", end: "05:00" }]; });
    await clinic.save(credentials.admin, config);
    const slots = (await schedule.preview(credentials.admin, day)).slots;
    const booked = await service.bookPatient(credentials.patient, input(slots.at(-1)!.startsAt));
    expect((await doctorService().view(credentials.admin, day)).appointments.map((a) => a.id)).toEqual([booked.id]);
  });
  it("handles empty/unconfigured lists without needing a contact key and validates dates", async () => {
    const noKey = createDoctorAppointmentsService(database.db, identity.access, () => { throw new Error("missing secret key"); }, clock);
    expect((await noKey.view(credentials.admin, date)).appointments).toEqual([]);
    for (const day of ["2026-02-30", "bad", "", "2026-11-10T09:00:00Z"]) expect((await doctorHandler()(httpRequest(`appointments?date=${day}`, "admin"))).status).toBe(400);
    await database.db.delete(clinicSettings);
    expect(await noKey.view(credentials.admin)).toEqual({ configured: false, date: "", timezone: "", appointments: [] });
  });
  it.each([false, true])("cancels atomically with original-time block=%s, preserving contacts, snapshots and receipts", async (block) => {
    await clinic.save(credentials.admin, { ...configuration(), bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    const slot = (await schedule.preview(credentials.admin, date)).slots[0];
    const booked = await service.bookPatient(credentials.patient, input(slot.startsAt));
    const [before] = await database.db.select().from(appointments), [occupied] = await database.db.select().from(reservations);
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 30 });
    const response = await doctorHandler()(httpRequest("appointments", "admin", doctorInput(booked.id, block)));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ appointment: { id: booked.id, status: "cancelled" } });
    const [after] = await database.db.select().from(appointments);
    expect(after).toEqual({ ...before, status: "cancelled", reservationId: null, cancelledAt: now, cancelledByStaffId: adminId,
      cancellationReason: "Doctor unavailable", rebookingInstruction: "Please book another available time.", originalTimeBlocked: block });
    expect(await counts()).toEqual([1, block ? 1 : 0, 2, 1]);
    if (block) expect(await database.db.select().from(reservations)).toEqual([{ ...occupied, kind: "block", reason: "Doctor unavailable" }]);
    expect((await database.db.select().from(bookingRequests))[0].receipt).toEqual(booked);
    expect((await database.db.select().from(bookingAudit).where(eq(bookingAudit.action, "cancelled")))[0]).toMatchObject({ actorKind: "staff", actorId: adminId, createdAt: now });
    expect((await database.db.execute(sql`select conname from pg_constraint where conname = 'reservation_no_overlap'`)).rows).toHaveLength(1);
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    expect((await database.db.select().from(appointments))[0]).toEqual(after);
  });
  it.each([false, true])("replays concurrent cancellations once (block=%s) and rejects changed retry details", async (block) => {
    const booked = await service.bookPatient(credentials.patient, input()), value = doctorInput(booked.id, block);
    const results = await Promise.all(Array.from({ length: 8 }, () => doctorService().cancel(credentials.admin, value)));
    expect(results).toEqual(Array.from({ length: 8 }, () => ({ id: booked.id, status: "cancelled" })));
    for (const change of [{ reason: "Different" }, { rebookingInstruction: "Different" }, { blockOriginalTime: !block }]) {
      await expect(doctorService().cancel(credentials.admin, { ...value, ...change })).rejects.toMatchObject({ code: "CANCELLATION_CONFLICT" });
    }
    now = new Date("2026-11-15T00:00Z");
    expect(await doctorService().cancel(credentials.admin, value)).toEqual(results[0]);
    expect(await counts()).toEqual([1, block ? 1 : 0, 2, 1]);
  });
  it("never changes replacement occupancy on a retry and never overwrites a patient cancellation", async () => {
    const first = await service.bookPatient(credentials.patient, input()), value = doctorInput(first.id);
    await doctorService().cancel(credentials.admin, value);
    const replacement = await service.bookForClinic(credentials.staff, clinicInput());
    const before = await database.db.select().from(reservations);
    await doctorService().cancel(credentials.admin, value);
    expect(await database.db.select().from(reservations)).toEqual(before);
    await doctorService().cancel(credentials.admin, doctorInput(replacement.id));
    const patientCancelled = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: patientCancelled.id });
    await expect(doctorService().cancel(credentials.admin, doctorInput(patientCancelled.id, true))).rejects.toMatchObject({ code: "CANCELLATION_CONFLICT" });
    expect((await database.db.select().from(appointments).where(eq(appointments.id, patientCancelled.id)))[0].cancelledByStaffId).toBeNull();
  });
  it("a saved block can be removed normally, and retrying cancellation does not restore it", async () => {
    const booked = await service.bookPatient(credentials.patient, input()), value = doctorInput(booked.id, true);
    await doctorService().cancel(credentials.admin, value);
    const [block] = await database.db.select().from(reservations);
    await schedule.removeBreak(credentials.admin, { date, id: block.id });
    const replacement = await service.bookPatient(credentials.other, input());
    const before = await database.db.select().from(reservations);
    await doctorService().cancel(credentials.admin, value);
    expect(await database.db.select().from(reservations)).toEqual(before);
    expect((await database.db.select().from(appointments).where(eq(appointments.id, replacement.id)))[0].status).toBe("confirmed");
  });
  it.each([false, true])("serializes doctor cancellation and patient/clinic rebooking (block=%s)", async (block) => {
    const booked = await service.bookPatient(credentials.patient, input());
    const results = await Promise.allSettled([doctorService().cancel(credentials.admin, doctorInput(booked.id, block)), service.bookForClinic(credentials.staff, clinicInput()), service.bookPatient(credentials.other, input())]);
    expect(results[0].status).toBe("fulfilled");
    expect(results.slice(1).filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(block ? 0 : 1);
    expect((await database.db.select().from(bookingAudit).where(eq(bookingAudit.action, "cancelled")))).toHaveLength(1);
    if (block) expect((await database.db.select().from(reservations))[0].kind).toBe("block");
  });
  it("patient and doctor racing to cancel produce one audit and no partial block", async () => {
    const booked = await service.bookPatient(credentials.patient, input());
    const results = await Promise.allSettled([doctorService().cancel(credentials.admin, doctorInput(booked.id, true)), cancellationService().cancel(credentials.patient, { appointmentId: booked.id })]);
    expect(results[1].status).toBe("fulfilled");
    const [row] = await database.db.select().from(appointments);
    expect(row.status).toBe("cancelled");
    expect(await counts()).toEqual([1, row.cancelledByStaffId ? 1 : 0, 2, 1]);
  });
  it.each(["anonymous", "patient", "other", "staff"])("enforces %s agenda and cancellation permissions", async (role) => {
    const booked = await service.bookPatient(credentials.patient, input());
    const expected = role === "staff" ? 403 : 401;
    expect((await doctorHandler()(httpRequest(`appointments?date=${date}`, role))).status).toBe(role === "staff" ? 200 : expected);
    expect((await doctorHandler()(httpRequest("appointments", role, doctorInput(booked.id)))).status).toBe(expected);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each(["revoked", "expired", "disabled", "demoted"])("enforces a %s admin’s agenda and cancellation access", async (state) => {
    const booked = await service.bookPatient(credentials.patient, input()), value = doctorInput(booked.id);
    await doctorService().cancel(credentials.admin, value);
    if (state === "revoked") await database.db.delete(staffSession).where(eq(staffSession.userId, adminId));
    if (state === "expired") await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.userId, adminId));
    if (state === "disabled") await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, adminId));
    if (state === "demoted") await database.db.update(staffAccess).set({ role: "staff", adminPinHash: null }).where(eq(staffAccess.userId, adminId));
    const list = await doctorHandler()(httpRequest(`appointments?date=${date}`, "admin"));
    if (state === "demoted") { expect(list.status).toBe(200); expect((await list.json()).appointments[0].canCancel).toBe(false); }
    else expect([401, 403]).toContain(list.status);
    expect([401, 403]).toContain((await doctorHandler()(httpRequest("appointments", "admin", value))).status);
    expect(await counts()).toEqual([1, 0, 2, 1]);
  });
  it.each(["revoked", "expired", "disabled", "demoted"])("rechecks a %s admin after the doctor lock wait", async (state) => {
    const booked = await service.bookPatient(credentials.patient, input());
    let passed!: () => void; const authenticated = new Promise<void>((resolve) => { passed = resolve; });
    const guarded = createDoctorAppointmentsService(database.db, { ...identity.access, async requireAdminAccess(headers) {
      const principal = await identity.access.requireAdminAccess(headers); passed(); return principal;
    } }, () => protection, clock);
    const blocker = await database.pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM doctor_profile WHERE id = 1 FOR UPDATE");
      pending = guarded.cancel(credentials.admin, doctorInput(booked.id, true));
      const rejected = expect(pending).rejects.toMatchObject({ statusCode: 403 }); await authenticated;
      if (state === "revoked") await database.db.delete(staffSession).where(eq(staffSession.userId, adminId));
      if (state === "expired") await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.userId, adminId));
      if (state === "disabled") await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, adminId));
      if (state === "demoted") await database.db.update(staffAccess).set({ role: "staff", adminPinHash: null }).where(eq(staffAccess.userId, adminId));
      await blocker.query("COMMIT"); await rejected; expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => {}); }
  });
  it.each(["started", "past", "completed", "no_show"])("rejects a %s visit without altering occupancy", async (state) => {
    const booked = await service.bookPatient(credentials.patient, input());
    if (state === "started") now = new Date(booked.startsAt);
    if (state === "past") now = new Date(booked.endsAt);
    if (state === "completed" || state === "no_show") await database.db.update(appointments).set({ status: state }).where(eq(appointments.id, booked.id));
    expect((await doctorHandler()(httpRequest("appointments", "admin", doctorInput(booked.id, true)))).status).toBe(409);
    expect((await doctorService().view(credentials.admin, date)).appointments[0].canCancel).toBe(false);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("validates strict input, origin and method, and returns a private not-found result", async () => {
    const booked = await service.bookPatient(credentials.patient, input()), value = doctorInput(booked.id);
    for (const origin of [null, "https://untrusted.example"]) expect((await doctorHandler()(httpRequest("appointments", "admin", value, origin))).status).toBe(403);
    expect((await doctorHandler()(httpRequest("appointments", "admin", value, baseURL, "PUT"))).status).toBe(405);
    for (const change of [{ appointmentId: "bad" }, { reason: " " }, { reason: "x".repeat(161) }, { reason: "hidden\nmedical" }, { rebookingInstruction: "x".repeat(301) }, { blockOriginalTime: "true" }, { role: "admin" }, { patientUserId: patientId }, { status: "cancelled" }]) {
      expect((await doctorHandler()(httpRequest("appointments", "admin", { ...value, ...change }))).status).toBe(400);
    }
    const malformed = new Request(`${baseURL}/api/admin/appointments`, { method: "POST", headers: { origin: baseURL }, body: "{" });
    expect((await doctorHandler()(malformed)).status).toBe(400);
    expect((await doctorHandler()(httpRequest("appointments", "admin", doctorInput(randomUUID())))).status).toBe(404);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each([false, true])("rolls back cancellation, metadata and optional block on audit failure (deferred=%s)", async (deferred) => {
    const booked = await service.bookPatient(credentials.patient, input());
    const before = await database.db.select().from(appointments), occupancy = await database.db.select().from(reservations);
    await database.db.execute(sql`CREATE FUNCTION reject_doctor_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private cancellation detail'; END $$`);
    await database.db.execute(sql.raw(`CREATE ${deferred ? "CONSTRAINT" : ""} TRIGGER reject_doctor_cancellation ${deferred ? "AFTER" : "BEFORE"} INSERT ON booking_audit ${deferred ? "DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW WHEN (NEW.action = 'cancelled') EXECUTE FUNCTION reject_doctor_cancellation()`));
    try {
      const response = await doctorHandler()(httpRequest("appointments", "admin", doctorInput(booked.id, true)));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("private cancellation detail");
      expect(await database.db.select().from(appointments)).toEqual(before); expect(await database.db.select().from(reservations)).toEqual(occupancy);
      expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await database.db.execute(sql`DROP TRIGGER reject_doctor_cancellation ON booking_audit`); await database.db.execute(sql`DROP FUNCTION reject_doctor_cancellation()`); }
    expect((await doctorHandler()(httpRequest("appointments", "admin", doctorInput(booked.id, true)))).status).toBe(200);
  });
  it("redacts contact decryption/configuration failures and can cancel without the encryption key", async () => {
    const booked = await service.bookPatient(credentials.patient, input());
    const broken = createDoctorAppointmentsService(database.db, identity.access, () => { throw new Error("private contact key"); }, clock);
    const handler = createDoctorAppointmentsHandler(() => broken, () => baseURL);
    const response = await handler(httpRequest(`appointments?date=${date}`, "admin"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private contact key");
    expect(await broken.cancel(credentials.admin, doctorInput(booked.id))).toEqual({ id: booked.id, status: "cancelled" });
  });
});

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
  it.each(["disabled", "revoked", "expired"])("rechecks %s staff access after waiting for the schedule lock", async (state) => {
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
      if (state === "disabled") await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, staffId));
      if (state === "revoked") await database.db.delete(staffSession).where(eq(staffSession.userId, staffId));
      if (state === "expired") await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.userId, staffId));
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
  const defaultDay = async () => {
    const response = await availabilityHandler()(httpRequest("availability"));
    expect(response.status).toBe(200);
    return (await response.json()).availability;
  };
  const selectedDay = async (day = date) => {
    const response = await availabilityHandler()(httpRequest(`availability?date=${day}`));
    expect(response.status).toBe(200);
    return (await response.json()).availability;
  };
  it("retains booked candidates without exposing another patient's data and releases cancellations on refresh", async () => {
    const booked = await service.bookPatient(credentials.other, input());
    await schedule.addBreak(credentials.admin, { date, start: "09:20", end: "09:40", reason: "private break" });
    const before = await counts(), view = await selectedDay();
    expect(view.slots).toHaveLength(8);
    expect(view.slots[0]).toEqual({ startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T09:20:00.000Z`, label: "9:00 AM – 9:20 AM", availability: "unavailable" });
    expect(view.slots[1].startsAt).toBe(`${date}T09:40:00.000Z`);
    for (const slot of view.slots) expect(Object.keys(slot).sort()).toEqual(["availability", "endsAt", "label", "startsAt"]);
    for (const secret of [booked.id, otherPatientId, "Synthetic Patient", "98765", "other@example.test", "private break", "reservationId", "occupiedStart"]) expect(JSON.stringify(view)).not.toContain(secret);
    expect(await counts()).toEqual(before);
    expect((await bookingHandler()(httpRequest("bookings", "patient", input()))).status).toBe(409);
    await cancellationService().cancel(credentials.other, { appointmentId: booked.id });
    expect((await selectedDay()).slots[0].availability).toBe("available");
  });
  it("skips fully booked default dates but retains unavailable candidates on explicit selection", async () => {
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 180, bookingHorizonDays: 1 });
    now = new Date("2026-11-09T10:00Z");
    await service.bookForClinic(credentials.admin, clinicInput(`${date}T09:00:00Z`));
    // Today is elapsed; tomorrow's sole candidate is occupied.
    expect(await defaultDay()).toMatchObject({ date: "2026-11-09", slots: [], noAvailableDates: true });
    const explicit = await selectedDay();
    expect(explicit).toMatchObject({ date, noAvailableDates: false, closed: false });
    expect(explicit.slots.map((slot: { availability: string }) => slot.availability)).toEqual(["unavailable"]);
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 180, bookingHorizonDays: 2 });
    expect(await defaultDay()).toMatchObject({ date: "2026-11-11", noAvailableDates: false });
  });
  it("uses saved appointment buffers against changed grid rules and retains special hours", async () => {
    await clinic.save(credentials.admin, { ...configuration(), bufferBeforeMinutes: 5, bufferAfterMinutes: 5 });
    await service.bookForClinic(credentials.admin, clinicInput(`${date}T09:05:00Z`));
    await clinic.save(credentials.admin, configuration());
    await schedule.saveOverride(credentials.admin, { date, mode: "custom", intervals: [{ start: "09:00", end: "10:00" }] });
    expect((await selectedDay()).slots.map((slot: { availability: string }) => slot.availability)).toEqual(["unavailable", "unavailable", "available"]);
    await schedule.addBreak(credentials.admin, { date, start: "09:40", end: "10:00" });
    expect((await selectedDay()).slots).toHaveLength(2);
  });
  it.each(["2026-03-08", "2026-11-01"])("refreshes occupied and cancelled candidates across DST on %s", async (day) => {
    now = new Date(`${day}T00:00Z`);
    const config = { ...configuration(), timezone: "America/New_York", bufferBeforeMinutes: 5, bufferAfterMinutes: 5 };
    config.weeklyHours.forEach((entry) => { entry.intervals = [{ start: "00:00", end: "05:00" }]; });
    await clinic.save(credentials.admin, config);
    const free = await selectedDay(day), chosen = free.slots.at(-1);
    const booked = await service.bookPatient(credentials.other, input(chosen.startsAt));
    const occupied = await selectedDay(day);
    expect(occupied.slots).toHaveLength(free.slots.length);
    expect(occupied.slots.at(-1)).toEqual({ ...chosen, availability: "unavailable" });
    await cancellationService().cancel(credentials.other, { appointmentId: booked.id });
    expect((await selectedDay(day)).slots).toEqual(free.slots);
  });
  it("keeps today selected when it still has bookable slots", async () => {
    const view = await defaultDay();
    expect(view).toMatchObject({ today: "2026-11-09", date: "2026-11-09", noAvailableDates: false });
    expect(view.slots[0].startsAt).toBe("2026-11-09T09:00:00.000Z");
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each(["after closing", "date closure", "weekly closure", "fully occupied"])("selects the next available day when today is unavailable: %s", async (reason) => {
    if (reason === "after closing") now = new Date("2026-11-09T12:00:00Z");
    if (reason === "date closure") await schedule.saveOverride(credentials.admin, { date: "2026-11-09", mode: "closed" });
    if (reason === "weekly closure") {
      const config = configuration(); config.weeklyHours[0].intervals = []; await clinic.save(credentials.admin, config);
    }
    if (reason === "fully occupied") await database.db.insert(reservations).values({ doctorId: 1, kind: "block", startsAt: new Date("2026-11-09T09:00Z"), endsAt: new Date("2026-11-09T12:00Z") });
    const before = await counts(), view = await defaultDay();
    expect(view).toMatchObject({ today: "2026-11-09", date, closed: false, noAvailableDates: false });
    expect(view.slots[0].startsAt).toBe(`${date}T09:00:00.000Z`); expect(await counts()).toEqual(before);
    const explicit = await (await availabilityHandler()(httpRequest("availability?date=2026-11-09"))).json();
    expect(explicit.availability).toMatchObject({ date: "2026-11-09", slots: [], noAvailableDates: false });
  });
  it("skips multiple closed or occupied dates instead of assuming tomorrow is available", async () => {
    now = new Date("2026-11-09T12:00Z");
    await schedule.saveOverride(credentials.admin, { date, mode: "closed", reason: "private holiday note" });
    await database.db.insert(reservations).values({ doctorId: 1, kind: "block", startsAt: new Date("2026-11-11T09:00Z"), endsAt: new Date("2026-11-11T12:00Z"), reason: "private break note" });
    const view = await defaultDay(); expect(view.date).toBe("2026-11-12"); expect(view.slots).toHaveLength(9);
    expect(JSON.stringify(view)).not.toContain("private"); expect(await counts()).toEqual([0, 1, 0, 0]);
  });
  it("respects minimum notice when finding the first bookable date", async () => {
    await clinic.save(credentials.admin, { ...configuration(), minLeadMinutes: 2880 });
    expect((await defaultDay()).date).toBe("2026-11-11"); expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("reports an empty booking window without going beyond its last date", async () => {
    now = new Date("2026-11-09T12:00Z");
    await clinic.save(credentials.admin, { ...configuration(), bookingHorizonDays: 1 });
    await schedule.saveOverride(credentials.admin, { date, mode: "closed" });
    expect(await defaultDay()).toMatchObject({ today: "2026-11-09", date: "2026-11-09", lastDate: date, slots: [], noAvailableDates: true });
    const explicit = await (await availabilityHandler()(httpRequest(`availability?date=${date}`))).json();
    expect(explicit.availability).toMatchObject({ date, closed: true, noAvailableDates: false }); expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("honors the exact horizon time even when the last calendar date has opening hours", async () => {
    const config = { ...configuration(), bookingHorizonDays: 1 }; config.weeklyHours[0].intervals = [];
    await clinic.save(credentials.admin, config);
    // Tomorrow's 9 AM opening is beyond now + one day (tomorrow at 8 AM).
    expect(await defaultDay()).toMatchObject({ lastDate: date, slots: [], noAvailableDates: true });
  });
  it("uses the clinic's current date when it differs from the UTC date", async () => {
    now = new Date("2026-11-09T20:00Z");
    await clinic.save(credentials.admin, { ...configuration(), timezone: "Asia/Kolkata" });
    await schedule.saveOverride(credentials.admin, { date, mode: "closed" });
    const view = await defaultDay(); expect(view).toMatchObject({ today: date, date: "2026-11-11", timezone: "Asia/Kolkata" });
    expect(view.slots[0].startsAt).toBe("2026-11-11T03:30:00.000Z");
  });
  it.each(["2026-03-08", "2026-11-01"])("finds the next clinic date across DST on %s", async (day) => {
    now = new Date(day === "2026-03-08" ? "2026-03-07T23:00Z" : "2026-10-31T22:00Z");
    const config = { ...configuration(), timezone: "America/New_York" };
    config.weeklyHours.forEach((entry) => { entry.intervals = [{ start: "00:00", end: "05:00" }]; });
    await clinic.save(credentials.admin, config);
    const view = await defaultDay(); expect(view.date).toBe(day);
    expect(view.slots).toEqual((await schedule.preview(credentials.admin, day)).slots.map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label, availability: "available" })));
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
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
    expect(data.availability.slots).toEqual((await schedule.preview(credentials.admin, date)).slots.map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label, availability: "available" })));
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
  it("competes with receptionist booking under the shared lock and refreshes occupied times", async () => {
    const results = await Promise.allSettled([bookingHandler()(httpRequest("bookings", "patient", input())), service.bookForClinic(credentials.staff, clinicInput())]);
    const patient = results[0]; expect(patient.status).toBe("fulfilled");
    if (patient.status !== "fulfilled") return;
    if (patient.value.status === 200) expect(results[1].status).toBe("rejected");
    else { expect(patient.value.status).toBe(409); expect(await patient.value.json()).toMatchObject({ code: "SLOT_UNAVAILABLE" }); expect(results[1].status).toBe("fulfilled"); }
    const { availability } = await (await availabilityHandler()(httpRequest(`availability?date=${date}`))).json();
    expect(availability.slots.find((slot: { startsAt: string }) => slot.startsAt === `${date}T09:00:00.000Z`)).toMatchObject({ availability: "unavailable" });
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
    expect(availability.slots).toEqual((await schedule.preview(credentials.admin, day)).slots.map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label, availability: "available" })));
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

describe("patient appointment cancellation", () => {
  it.each([[7_200_001, false], [7_200_000, false], [7_199_999, true], [1, true]] as const)("records cancellation with %s ms notice, preserving it on retry", async (notice, late) => {
    const booked = await service.bookPatient(credentials.patient, input());
    now = new Date(Date.parse(booked.startsAt) - notice);
    const cancelledAt = now;
    await cancellationService().cancel(credentials.patient, { appointmentId: booked.id });
    const [saved] = await database.db.select().from(appointments);
    expect(saved).toMatchObject({ status: "cancelled", reservationId: null, patientCancelledAt: cancelledAt, patientCancellationLate: late });
    const patientView = await createPatientAppointmentsService(database.db, identity.patientAccess, clock).view(credentials.patient);
    expect(patientView.history[0]).toMatchObject({ patientCancellationLate: late });
    expect((await doctorService().view(credentials.admin, date)).appointments[0]).toMatchObject({ patientCancellationLate: late });
    now = new Date(Date.parse(booked.endsAt) + 1);
    await cancellationService().cancel(credentials.patient, { appointmentId: booked.id });
    expect((await database.db.select().from(appointments))[0]).toEqual(saved);
    expect(await counts()).toEqual([1, 0, 2, 1]);
    await expect(database.db.update(appointments).set({ patientCancellationLate: !late }).where(eq(appointments.id, booked.id))).rejects.toThrow();
  });

  it("replays the migration and atomically retains history, releases buffered time and records an audit", async () => {
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    await clinic.save(credentials.admin, { ...configuration(), timezone: "Asia/Kolkata", bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    const slot = (await schedule.preview(credentials.admin, date)).slots[0];
    const booked = await service.bookPatient(credentials.patient, input(slot.startsAt));
    const [before] = await database.db.select().from(appointments);
    const response = await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ appointment: { id: booked.id, status: "cancelled" } });
    expect(await counts()).toEqual([1, 0, 2, 1]);
    const [after] = await database.db.select().from(appointments);
    expect(after).toEqual({ ...before, status: "cancelled", reservationId: null, patientCancelledAt: now, patientCancellationLate: false });
    expect((await database.db.select().from(bookingRequests))[0].receipt).toEqual(booked);
    const [audit] = await database.db.select().from(bookingAudit).where(eq(bookingAudit.action, "cancelled"));
    expect(audit).toMatchObject({ appointmentId: booked.id, actorKind: "patient", actorId: patientId, createdAt: now });
    expect((await schedule.preview(credentials.admin, date)).slots[0]).toEqual(slot);
    const view = await createPatientAppointmentsService(database.db, identity.patientAccess, clock).view(credentials.patient);
    expect(view.upcoming).toEqual([]); expect(view.history[0]).toMatchObject({ id: booked.id, status: "cancelled" });
    const constraint = await database.db.execute(sql`select conname from pg_constraint where conname = 'reservation_no_overlap'`);
    expect(constraint.rows).toHaveLength(1);
    await expect(database.db.insert(bookingAudit).values({ appointmentId: booked.id, action: "cancelled", actorKind: "patient", actorId: patientId })).rejects.toThrow();
    await expect(database.db.insert(bookingAudit).values({ appointmentId: booked.id, action: "unknown", actorKind: "patient", actorId: patientId })).rejects.toThrow();
  });
  it("handles more simultaneous cancellations than the pool size without duplicate events or deadlock", async () => {
    const booked = await service.bookPatient(credentials.patient, input());
    const results = await Promise.all(Array.from({ length: 8 }, () => cancellationService().cancel(credentials.patient, { appointmentId: booked.id })));
    expect(results).toEqual(Array.from({ length: 8 }, () => ({ id: booked.id, status: "cancelled" })));
    now = new Date("2026-11-15T00:00Z");
    expect(await cancellationService().cancel(credentials.patient, { appointmentId: booked.id })).toEqual(results[0]);
    expect(await counts()).toEqual([1, 0, 2, 1]);
  });
  it.each(["patient", "staff"])("cannot release the %s booking that later takes the original time", async (actor) => {
    const value = input(), booked = await service.bookPatient(credentials.patient, value);
    await cancellationService().cancel(credentials.patient, { appointmentId: booked.id });
    const replacement = actor === "patient" ? await service.bookPatient(credentials.other, input()) : await service.bookForClinic(credentials.staff, clinicInput());
    const before = await database.db.select().from(reservations);
    expect((await cancellationService().cancel(credentials.patient, { appointmentId: booked.id })).status).toBe("cancelled");
    expect(await database.db.select().from(reservations)).toEqual(before);
    expect((await database.db.select().from(appointments).where(eq(appointments.id, replacement.id)))[0].status).toBe("confirmed");
    expect(await counts()).toEqual([2, 1, 3, 2]);
    // Replaying the original creation receipt must not resurrect its cancelled row.
    expect(await service.bookPatient(credentials.patient, value)).toEqual(booked);
    expect((await database.db.select().from(appointments).where(eq(appointments.id, booked.id)))[0].status).toBe("cancelled");
  });
  it("serializes cancellation with a competing clinic booking for the released time", async () => {
    const booked = await service.bookPatient(credentials.patient, input());
    const result = await Promise.allSettled([cancellationService().cancel(credentials.patient, { appointmentId: booked.id }), service.bookForClinic(credentials.staff, clinicInput())]);
    expect(result[0].status).toBe("fulfilled");
    const rows = await database.db.select().from(appointments);
    expect(rows.find((row) => row.id === booked.id)).toMatchObject({ status: "cancelled", reservationId: null });
    if (result[1].status === "fulfilled") expect(await counts()).toEqual([2, 1, 3, 2]);
    else { expect(result[1].reason).toMatchObject({ code: "SLOT_UNAVAILABLE" }); expect(await counts()).toEqual([1, 0, 2, 1]); }
  });
  it.each(["anonymous", "admin", "staff"])("rejects %s access without changing the appointment", async (role) => {
    const booked = await service.bookPatient(credentials.patient, input());
    const response = await cancellationHandler()(httpRequest("appointments/cancel", role, { appointmentId: booked.id }));
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: "SIGN_IN_REQUIRED" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("hides other-patient and unlinked bookings behind the same not-found response", async () => {
    const other = await service.bookPatient(credentials.other, input()), unlinked = await service.bookForClinic(credentials.admin, clinicInput(`${date}T09:20:00Z`));
    const results = [];
    for (const id of [other.id, unlinked.id, randomUUID()]) {
      const response = await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: id }));
      expect(response.status).toBe(404); results.push(await response.json());
    }
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
    expect(await counts()).toEqual([2, 2, 2, 2]);
  });
  it.each(["revoked", "expired", "unverified"])("rejects a %s patient and cancellation retries", async (kind) => {
    const booked = await service.bookPatient(credentials.patient, input());
    await cancellationService().cancel(credentials.patient, { appointmentId: booked.id });
    if (kind === "revoked") await database.db.delete(patientSession).where(eq(patientSession.userId, patientId));
    if (kind === "expired") await database.db.update(patientSession).set({ expiresAt: new Date(0) }).where(eq(patientSession.userId, patientId));
    if (kind === "unverified") await database.db.update(patientUser).set({ emailVerified: false }).where(eq(patientUser.id, patientId));
    expect((await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }))).status).toBe(401);
    expect(await counts()).toEqual([1, 0, 2, 1]);
  });
  it.each(["revoked", "expired", "unverified"])("rechecks a %s patient after waiting for the doctor lock", async (kind) => {
    const booked = await service.bookPatient(credentials.patient, input());
    let passed!: () => void; const authenticated = new Promise<void>((resolve) => { passed = resolve; });
    const guarded = createPatientCancellationService(database.db, { async requirePatientAccess(headers) {
      const principal = await identity.patientAccess.requirePatientAccess(headers); passed(); return principal;
    } }, clock);
    const blocker = await database.pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM doctor_profile WHERE id = 1 FOR UPDATE");
      pending = guarded.cancel(credentials.patient, { appointmentId: booked.id });
      const rejected = expect(pending).rejects.toMatchObject({ statusCode: 401 });
      await authenticated;
      if (kind === "revoked") await database.db.delete(patientSession).where(eq(patientSession.userId, patientId));
      if (kind === "expired") await database.db.update(patientSession).set({ expiresAt: new Date(0) }).where(eq(patientSession.userId, patientId));
      if (kind === "unverified") await database.db.update(patientUser).set({ emailVerified: false }).where(eq(patientUser.id, patientId));
      await blocker.query("COMMIT"); await rejected;
      expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending?.catch(() => {}); }
  });
  it.each(["started", "past", "completed", "no_show"])("rejects a %s appointment without releasing occupancy", async (state) => {
    const booked = await service.bookPatient(credentials.patient, input());
    if (state === "started") now = new Date(booked.startsAt);
    if (state === "past") now = new Date(booked.endsAt);
    if (state === "completed" || state === "no_show") await database.db.update(appointments).set({ status: state }).where(eq(appointments.id, booked.id));
    const response = await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANCELLATION_NOT_ALLOWED" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("validates origin, method, JSON and strict appointment-only input", async () => {
    const booked = await service.bookPatient(credentials.patient, input());
    for (const origin of [null, "https://untrusted.example"]) expect((await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }, origin))).status).toBe(403);
    expect((await cancellationHandler()(httpRequest("appointments/cancel"))).status).toBe(405);
    for (const value of [{ appointmentId: "invalid" }, { appointmentId: booked.id, patientUserId: patientId }, { appointmentId: booked.id, status: "cancelled" }, { appointmentId: booked.id, role: "admin" }]) {
      expect((await cancellationHandler()(httpRequest("appointments/cancel", "patient", value))).status).toBe(400);
    }
    const response = await cancellationHandler()(new Request(`${baseURL}/api/patient/appointments/cancel`, { method: "POST", headers: { cookie: credentials.patient.get("cookie")!, origin: baseURL }, body: "{" }));
    expect(response.status).toBe(400); expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each([false, true])("rolls back a cancellation and released occupancy on failure (deferred=%s)", async (deferred) => {
    const booked = await service.bookPatient(credentials.patient, input());
    await database.db.execute(sql`CREATE FUNCTION reject_patient_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private cancellation failure'; END $$`);
    const when = deferred ? "AFTER" : "BEFORE", constraint = deferred ? "CONSTRAINT" : "", timing = deferred ? "DEFERRABLE INITIALLY DEFERRED" : "";
    await database.db.execute(sql.raw(`CREATE ${constraint} TRIGGER reject_patient_cancellation ${when} INSERT ON booking_audit ${timing} FOR EACH ROW WHEN (NEW.action = 'cancelled') EXECUTE FUNCTION reject_patient_cancellation()`));
    try {
      const response = await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("private cancellation failure");
      expect(await counts()).toEqual([1, 1, 1, 1]);
      expect((await database.db.select().from(appointments))[0]).toMatchObject({ status: "confirmed", reservationId: expect.any(String), patientCancelledAt: null, patientCancellationLate: null });
    } finally { await database.db.execute(sql`DROP TRIGGER reject_patient_cancellation ON booking_audit`); await database.db.execute(sql`DROP FUNCTION reject_patient_cancellation()`); }
    expect((await cancellationHandler()(httpRequest("appointments/cancel", "patient", { appointmentId: booked.id }))).status).toBe(200);
    expect(await counts()).toEqual([1, 0, 2, 1]);
  });
});


describe("WhatsApp Phase 1", () => {
  const enabledService = () => createBookingService(database.db, { ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient) }, protection, clock, whatsappBookingEvents);
  const withdrawalHandler = () => createWhatsAppConsentHandler(database.db, identity.patientAccess, () => baseURL);
  const jobs = () => database.db.select().from(whatsappNotifications);
  const attempts = () => database.db.select().from(whatsappAttempts);
  const directEnv = { WHATSAPP_ENABLED: "true", WHATSAPP_USE_WORKER: "false", WHATSAPP_ACCESS_TOKEN: "synthetic-token", WHATSAPP_API_VERSION: "v25.0", WHATSAPP_TEST_PHONE_NUMBER_ID: "123456", WHATSAPP_TEST_RECIPIENT: "+919876543210", WHATSAPP_TEMPLATE_NAME: "hello_world", WHATSAPP_TEMPLATE_LANGUAGE: "en_US" };
  it("sends the committed request appointment only, once across concurrent request and worker dispatch", async () => {
    await enabledService().bookPatient(credentials.other, { ...input(`${date}T09:20:00Z`), whatsappConsent: true });
    const report = vi.fn();
    const send = vi.fn(async (): Promise<SendResult> => {
      expect(await counts()).toEqual([2, 2, 2, 2]);
      return { status: "accepted", apiMessageId: "wamid.request" };
    });
    const after = createPostBookingWhatsApp(() => database.db, directEnv, () => ({ send }), report, clock);
    const handler = createPatientBookingHandler(enabledService, () => baseURL, after);
    const value = { ...input(), whatsappConsent: true };
    const first = await handler(httpRequest("bookings", "patient", value));
    expect(first.status).toBe(200); const { receipt } = await first.json();
    expect(send).toHaveBeenCalledTimes(1); expect(report).not.toHaveBeenCalled();
    const selected = (await jobs()).find((j) => j.appointmentId === receipt.id)!;
    expect(selected).toMatchObject({ status: "accepted", attempts: 1, apiMessageId: "wamid.request" });
    expect((await jobs()).find((j) => j.appointmentId !== receipt.id)).toMatchObject({ status: "pending", attempts: 0 });
    await Promise.all([handler(httpRequest("bookings", "patient", value)), handler(httpRequest("bookings", "patient", value)), createWhatsAppDelivery(database.db, { send }, clock, report).sendForAppointment(receipt.id)]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("shares the active send claim across the request, its retry and a worker", async () => {
    let started!: () => void, release!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const finish = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async (): Promise<SendResult> => { started(); await finish; return { status: "accepted", apiMessageId: "wamid.concurrent" }; });
    const report = vi.fn();
    const after = createPostBookingWhatsApp(() => database.db, directEnv, () => ({ send }), report, clock);
    const handler = createPatientBookingHandler(enabledService, () => baseURL, after), value = { ...input(), whatsappConsent: true };
    const first = handler(httpRequest("bookings", "patient", value));
    try {
      await sending;
      expect((await handler(httpRequest("bookings", "patient", value))).status).toBe(200);
      expect(await createWhatsAppDelivery(database.db, { send }, clock, report).runOnce()).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
    } finally { release(); }
    expect((await first).status).toBe(200);
    expect((await attempts())[0]).toMatchObject({ status: "accepted", number: 1 });
  });
  it("returns success after an accepted send even when result persistence fails", async () => {
    await database.db.execute(sql`CREATE FUNCTION reject_whatsapp_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'accepted' THEN RAISE EXCEPTION 'private result failure'; END IF; RETURN NEW; END $$`);
    await database.db.execute(sql`CREATE TRIGGER reject_whatsapp_result BEFORE UPDATE ON whatsapp_notifications FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_result()`);
    const send = vi.fn(async (): Promise<SendResult> => ({ status: "accepted", apiMessageId: "wamid.unpersisted" })), report = vi.fn();
    const after = createPostBookingWhatsApp(() => database.db, directEnv, () => ({ send }), report, clock);
    const handler = createPatientBookingHandler(enabledService, () => baseURL, after), value = { ...input(), whatsappConsent: true };
    try {
      const response = await handler(httpRequest("bookings", "patient", value));
      expect(response.status).toBe(200); expect((await response.json()).receipt.status).toBe("confirmed");
      expect((await jobs())[0]).toMatchObject({ status: "sending", attempts: 1 });
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: "REQUEST_DELIVERY_FAILED" }));
      expect(JSON.stringify(report.mock.calls)).not.toContain("private result failure");
      expect((await handler(httpRequest("bookings", "patient", value))).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_whatsapp_result ON whatsapp_notifications`);
      await database.db.execute(sql`DROP FUNCTION reject_whatsapp_result()`);
    }
  });
  it.each(["failed", "uncertain", "throw"])("keeps booking successful when direct delivery is %s", async (outcome) => {
    const report = vi.fn();
    const send = vi.fn(async (): Promise<SendResult> => {
      if (outcome === "throw") throw new Error("private provider token");
      return outcome === "failed" ? { status: "failed", errorCode: "META_130429", retryable: true } : { status: "uncertain", errorCode: "NETWORK_OR_TIMEOUT" };
    });
    const after = createPostBookingWhatsApp(() => database.db, directEnv, () => ({ send }), report, clock);
    const handler = createPatientBookingHandler(enabledService, () => baseURL, after), value = { ...input(), whatsappConsent: true };
    const response = await handler(httpRequest("bookings", "patient", value));
    expect(response.status).toBe(200); expect((await response.json()).receipt.status).toBe("confirmed");
    expect(await counts()).toEqual([1, 1, 1, 1]);
    expect((await jobs())[0]).toMatchObject({ status: outcome === "failed" ? "failed" : "uncertain", attempts: 1 });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: outcome === "failed" ? "failed" : "uncertain" }));
    expect(JSON.stringify(report.mock.calls)).not.toContain("private provider token");
    expect((await handler(httpRequest("bookings", "patient", value))).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("preserves a booked receipt on notification database failure and skips failed/no-consent bookings", async () => {
    const report = vi.fn(), send = vi.fn(async (): Promise<SendResult> => ({ status: "accepted", apiMessageId: "wamid.request" }));
    const failedDb = createPostBookingWhatsApp(() => { throw new Error("private database secret"); }, directEnv, () => ({ send }), report, clock);
    const handler = createPatientBookingHandler(enabledService, () => baseURL, failedDb);
    const response = await handler(httpRequest("bookings", "patient", { ...input(), whatsappConsent: true }));
    expect(response.status).toBe(200); expect((await response.json()).receipt.status).toBe("confirmed");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: "REQUEST_DELIVERY_FAILED" }));
    expect(send).not.toHaveBeenCalled(); expect(JSON.stringify(report.mock.calls)).not.toContain("private database secret");
    const after = createPostBookingWhatsApp(() => database.db, directEnv, () => ({ send }), report, clock);
    const directHandler = createPatientBookingHandler(enabledService, () => baseURL, after);
    expect((await directHandler(httpRequest("bookings", "other", input(`${date}T09:20:00Z`)))).status).toBe(200);
    expect((await directHandler(httpRequest("bookings", "other", { ...input(`${date}T22:00:00Z`), whatsappConsent: true }))).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it("stores both consent choices, queues only opt-in and preserves consent on receipt replay", async () => {
    const booking = enabledService(), value = { ...input(), whatsappConsent: true };
    const results = await Promise.all([booking.bookPatient(credentials.patient, value), booking.bookPatient(credentials.patient, value)]);
    expect(results[0]).toEqual(results[1]);
    await expect(booking.bookPatient(credentials.patient, { ...value, whatsappConsent: false })).rejects.toMatchObject({ code: "REQUEST_KEY_CONFLICT" });
    await booking.bookPatient(credentials.other, input(`${date}T09:20:00Z`));
    expect(await database.db.select().from(whatsappConsents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ appointmentId: results[0].id, consented: true, recordedAt: now, withdrawn: false, withdrawnAt: null }),
      expect.objectContaining({ consented: false, recordedAt: now, withdrawn: false }),
    ]));
    expect(await jobs()).toHaveLength(1);
    await expect(database.db.insert(whatsappNotifications).values({ appointmentId: results[0].id })).rejects.toThrow();
    expect(await attempts()).toHaveLength(0);
  });
  it.each([false, true])("rolls back jobs, consent and booking on failure (deferred=%s)", async (deferred) => {
    await database.db.execute(sql`CREATE FUNCTION reject_whatsapp_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$`);
    await database.db.execute(sql.raw(deferred
      ? "CREATE CONSTRAINT TRIGGER reject_whatsapp_job AFTER INSERT ON whatsapp_notifications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_job()"
      : "CREATE TRIGGER reject_whatsapp_job BEFORE INSERT ON whatsapp_notifications FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_job()"));
    const value = { ...input(), whatsappConsent: true };
    try {
      await expect(enabledService().bookPatient(credentials.patient, value)).rejects.toThrow();
      expect(await counts()).toEqual([0, 0, 0, 0]);
      expect(await jobs()).toHaveLength(0); expect(await database.db.select().from(whatsappConsents)).toHaveLength(0);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_whatsapp_job ON whatsapp_notifications`);
      await database.db.execute(sql`DROP FUNCTION reject_whatsapp_job()`);
    }
    await enabledService().bookPatient(credentials.patient, value);
    expect(await jobs()).toHaveLength(1);
  });
  it("rejects stale bookings without jobs and checks consent types", async () => {
    await expect(enabledService().bookPatient(credentials.patient, { ...input("2026-11-10T22:00:00Z"), whatsappConsent: true })).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await expect(enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: "true" })).rejects.toThrow();
    expect(await jobs()).toHaveLength(0);
  });
  it("sends only committed work once across workers and records API acceptance", async () => {
    const receipt = await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    const send = vi.fn(async () => {
      // A separate pool connection sees the appointment only after COMMIT.
      expect(await database.db.select().from(appointments).where(eq(appointments.id, receipt.id))).toHaveLength(1);
      return { status: "accepted" as const, apiMessageId: "wamid.synthetic" };
    });
    await Promise.all([createWhatsAppDelivery(database.db, { send }, clock).runOnce(), createWhatsAppDelivery(database.db, { send }, clock).runOnce()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]).toMatchObject({ status: "accepted", attempts: 1, apiMessageId: "wamid.synthetic", errorCode: null });
    expect((await attempts())[0]).toMatchObject({ status: "accepted", number: 1, apiMessageId: "wamid.synthetic", finishedAt: now });
    expect(await createWhatsAppDelivery(database.db, { send }, clock).runOnce()).toBe(false);
  });
  it("withdraws only owned consent, preserves timestamps on retry and suppresses queued work", async () => {
    const booking = enabledService(), value = { ...input(), whatsappConsent: true };
    const receipt = await booking.bookPatient(credentials.patient, value);
    const body = { appointmentId: receipt.id };
    for (const role of ["anonymous", "admin", "other"]) expect((await withdrawalHandler()(httpRequest("whatsapp/withdraw", role, body))).status).toBe(role === "other" ? 404 : 401);
    expect((await withdrawalHandler()(httpRequest("whatsapp/withdraw", "patient", body, "https://forged.test"))).status).toBe(403);
    expect((await withdrawalHandler()(httpRequest("whatsapp/withdraw", "patient", { ...body, patientUserId: otherPatientId }))).status).toBe(400);
    expect((await withdrawalHandler()(httpRequest("whatsapp/withdraw", "patient", { appointmentId: randomUUID() }))).status).toBe(404);
    const response = await withdrawalHandler()(httpRequest("whatsapp/withdraw", "patient", body));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const [consent] = await database.db.select().from(whatsappConsents);
    expect(consent.withdrawn).toBe(true); expect(consent.withdrawnAt).toBeInstanceOf(Date);
    await withdrawalHandler()(httpRequest("whatsapp/withdraw", "patient", body));
    expect((await database.db.select().from(whatsappConsents))[0]).toEqual(consent);
    await booking.bookPatient(credentials.patient, value);
    expect((await database.db.select().from(whatsappConsents))[0]).toEqual(consent);
    expect((await createPatientAppointmentsService(database.db, identity.patientAccess).list(credentials.patient))[0].whatsappConsentActive).toBe(false);
    const send = vi.fn(); await createWhatsAppDelivery(database.db, { send }, clock).runOnce();
    expect(send).not.toHaveBeenCalled(); expect((await jobs())[0].status).toBe("suppressed");
  });
  it.each(["cancelled", "past", "withdrawn"])("suppresses %s notifications at dispatch", async (reason) => {
    const receipt = await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    if (reason === "cancelled") await cancellationService().cancel(credentials.patient, { appointmentId: receipt.id });
    if (reason === "past") now = new Date(receipt.startsAt);
    if (reason === "withdrawn") await database.db.update(whatsappConsents).set({ withdrawn: true, withdrawnAt: now });
    const send = vi.fn(); await createWhatsAppDelivery(database.db, { send }, clock).runOnce();
    expect(send).not.toHaveBeenCalled(); expect((await jobs())[0]).toMatchObject({ status: "suppressed", attempts: 0 });
  });
  it("bounds definite rate-limit retries and logs each attempt", async () => {
    await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    const send = vi.fn(async () => ({ status: "failed" as const, errorCode: "META_130429", retryable: true }));
    const worker = createWhatsAppDelivery(database.db, { send }, clock);
    for (let i = 1; i <= 3; i++) {
      await worker.runOnce();
      expect((await jobs())[0]).toMatchObject({ attempts: i, status: i < 3 ? "pending" : "failed" });
      expect(await worker.runOnce()).toBe(false);
      now = new Date(now.getTime() + i * 60_000);
    }
    expect(send).toHaveBeenCalledTimes(3); expect(await attempts()).toHaveLength(3);
  });
  it("records uncertain outcomes and never retries them automatically", async () => {
    await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    const send = vi.fn(async () => { throw new Error("private access token"); });
    const worker = createWhatsAppDelivery(database.db, { send }, clock);
    await worker.runOnce(); expect(await worker.runOnce()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]).toMatchObject({ status: "uncertain", errorCode: "SENDER_INTERRUPTED" });
    expect(JSON.stringify(await attempts())).not.toContain("private access token");
  });
  it("reconciles a late accepted result from the same interrupted attempt without resending", async () => {
    await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    const send = vi.fn(async () => {
      now = new Date(now.getTime() + 61_000);
      const otherSend = vi.fn();
      expect(await createWhatsAppDelivery(database.db, { send: otherSend }, clock).runOnce()).toBe(false);
      expect(otherSend).not.toHaveBeenCalled();
      expect((await jobs())[0].status).toBe("uncertain");
      return { status: "accepted" as const, apiMessageId: "wamid.late" };
    });
    await createWhatsAppDelivery(database.db, { send }, clock).runOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]).toMatchObject({ status: "accepted", attempts: 1, apiMessageId: "wamid.late" });
    expect((await attempts())[0]).toMatchObject({ status: "accepted", apiMessageId: "wamid.late" });
  });
  it("preserves pre-integration receipt replay without adding consent or notifications", async () => {
    const value = input(), original = await service.bookPatient(credentials.patient, value);
    expect(await enabledService().bookPatient(credentials.patient, { ...value, whatsappConsent: false })).toEqual(original);
    expect(await jobs()).toHaveLength(0);
    expect(await database.db.select().from(whatsappConsents)).toHaveLength(0);
  });
  it("marks interrupted sends uncertain after restart without resending", async () => {
    await enabledService().bookPatient(credentials.patient, { ...input(), whatsappConsent: true });
    const [job] = await jobs();
    await database.db.update(whatsappNotifications).set({ status: "sending", attempts: 1, updatedAt: new Date(now.getTime() - 60_001) });
    await database.db.insert(whatsappAttempts).values({ notificationId: job.id, number: 1, status: "sending", startedAt: new Date(now.getTime() - 60_001) });
    const send = vi.fn(); await createWhatsAppDelivery(database.db, { send }, clock).runOnce();
    expect(send).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({ status: "uncertain", errorCode: "DELIVERY_INTERRUPTED" });
    expect((await attempts())[0]).toMatchObject({ status: "uncertain", errorCode: "DELIVERY_INTERRUPTED" });
  });
});


describe("clinic booking endpoints and receptionist agenda", () => {
  const handler = () => createClinicBookingHandler(() => service, () => baseURL);
  const times = () => createClinicAvailabilityHandler(() => createClinicBookingAvailability(database.db, identity.access, clock));
  it.each(["admin", "staff"])("lets %s read slots, commit a booking and see the agenda without auto-linking patient email", async (role) => {
    const available = await times()(httpRequest(`booking-availability?date=${date}`, role));
    expect(available.status).toBe(200); expect(available.headers.get("Cache-Control")).toBe("private, no-store");
    const view = await available.json();
    expect(view).toMatchObject({ configured: true, date, timezone: "UTC" });
    expect(view.slots[0]).toMatchObject({ availability: "available" });
    expect(await counts()).toEqual([0, 0, 0, 0]);
    const value = clinicInput(), response = await handler()(httpRequest("bookings", role, value));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    const { receipt } = await response.json();
    expect(receipt).toMatchObject({ status: "confirmed", durationMinutes: 20 });
    const [saved] = await database.db.select().from(appointments);
    expect(saved).toMatchObject({ id: receipt.id, source: "clinic", patientUserId: null, createdByStaffId: role === "admin" ? adminId : staffId });
    expect(saved.contactCiphertext).not.toContain(adminEmail);
    const agenda = await doctorService().view(credentials[role], date);
    expect(agenda.appointments[0]).toMatchObject({ id: receipt.id, canCancel: role === "admin", contact: { name: value.name, email: adminEmail, phone: "+919876543210" } });
    const patientList = await createPatientAppointmentsService(database.db, identity.patientAccess, clock).view(credentials.patient);
    expect(JSON.stringify(patientList)).not.toContain(receipt.id);
    const updated = await (await times()(httpRequest(`booking-availability?date=${date}`, role))).json();
    expect(updated.slots.find((slot: { startsAt: string }) => slot.startsAt === receipt.startsAt).availability).toBe("unavailable");
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("returns a single receipt across concurrent HTTP retries, with actor-scoped keys", async () => {
    const value = clinicInput();
    const responses = await Promise.all(Array.from({ length: 4 }, () => handler()(httpRequest("bookings", "staff", value))));
    for (const response of responses) expect(response.status).toBe(200);
    const receipts = await Promise.all(responses.map(async (r) => (await r.json()).receipt));
    expect(new Set(receipts.map((r) => r.id)).size).toBe(1);
    const next = await handler()(httpRequest("bookings", "admin", { ...value, startsAt: `${date}T09:20:00Z` }));
    expect(next.status).toBe(200); expect((await next.json()).receipt.id).not.toBe(receipts[0].id);
    const conflict = await handler()(httpRequest("bookings", "staff", { ...value, name: "Changed" }));
    expect(conflict.status).toBe(409); expect((await conflict.json()).code).toBe("REQUEST_KEY_CONFLICT");
    expect(await counts()).toEqual([2, 2, 2, 2]);
  });
  it("serializes competing patient and receptionist HTTP bookings", async () => {
    const results = await Promise.all([handler()(httpRequest("bookings", "staff", clinicInput())), bookingHandler()(httpRequest("bookings", "patient", input()))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each(["anonymous", "patient", "other"])("denies %s boundary on slots, booking and agenda", async (role) => {
    expect((await times()(httpRequest(`booking-availability?date=${date}`, role))).status).toBe(401);
    expect((await handler()(httpRequest("bookings", role, clinicInput()))).status).toBe(401);
    expect((await doctorHandler()(httpRequest(`appointments?date=${date}`, role))).status).toBe(401);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each(["disabled", "revoked", "expired"])("denies %s staff even on a receipt replay", async (state) => {
    const value = clinicInput(); expect((await handler()(httpRequest("bookings", "staff", value))).status).toBe(200);
    if (state === "disabled") await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, staffId));
    if (state === "revoked") await database.db.delete(staffSession).where(eq(staffSession.userId, staffId));
    if (state === "expired") await database.db.update(staffSession).set({ expiresAt: new Date(0) }).where(eq(staffSession.userId, staffId));
    for (const response of [await times()(httpRequest(`booking-availability?date=${date}`, "staff")), await handler()(httpRequest("bookings", "staff", value)), await doctorHandler()(httpRequest(`appointments?date=${date}`, "staff"))])
      expect([401, 403]).toContain(response.status);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("keeps cancellation, settings and availability editing admin-only", async () => {
    const { receipt } = await (await handler()(httpRequest("bookings", "staff", clinicInput()))).json();
    expect((await doctorHandler()(httpRequest("appointments", "staff", doctorInput(receipt.id)))).status).toBe(403);
    await expect(clinic.save(credentials.staff, configuration())).rejects.toMatchObject({ statusCode: 403 });
    await expect(schedule.addBreak(credentials.staff, { date, start: "10:00", end: "10:20" })).rejects.toMatchObject({ statusCode: 403 });
    expect((await doctorService().view(credentials.staff, date)).appointments[0].canCancel).toBe(false);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("rejects forged origins and fields, malformed JSON and wrong methods", async () => {
    for (const origin of [null, "https://forged.example"]) expect((await handler()(httpRequest("bookings", "staff", clinicInput(), origin))).status).toBe(403);
    for (const extra of [{ patientUserId: patientId }, { role: "admin" }, { durationMinutes: 60 }, { whatsappConsent: true }, { createdByStaffId: adminId }])
      expect((await handler()(httpRequest("bookings", "staff", { ...clinicInput(), ...extra }))).status).toBe(400);
    const malformed = new Request(`${baseURL}/api/admin/bookings`, { method: "POST", headers: new Headers({ ...Object.fromEntries(credentials.staff), origin: baseURL, "content-type": "application/json" }), body: "{" });
    expect((await handler()(malformed)).status).toBe(400);
    expect((await handler()(httpRequest("bookings", "staff"))).status).toBe(405);
    expect((await times()(httpRequest("booking-availability", "staff", {}))).status).toBe(405);
    expect((await times()(httpRequest("booking-availability?date=bad", "staff"))).status).toBe(400);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each([false, true])("rolls back the entire clinic confirmation on receipt failure (deferred=%s)", async (deferred) => {
    await database.db.execute(sql`CREATE FUNCTION reject_clinic_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private clinic receipt'; END $$`);
    await database.db.execute(sql.raw(`CREATE ${deferred ? "CONSTRAINT" : ""} TRIGGER reject_clinic_receipt ${deferred ? "AFTER" : "BEFORE"} INSERT ON booking_requests ${deferred ? "DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW EXECUTE FUNCTION reject_clinic_receipt()`));
    const value = clinicInput();
    try {
      const response = await handler()(httpRequest("bookings", "staff", value));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain("private clinic receipt");
      expect(await counts()).toEqual([0, 0, 0, 0]);
    } finally { await database.db.execute(sql`DROP TRIGGER reject_clinic_receipt ON booking_requests`); await database.db.execute(sql`DROP FUNCTION reject_clinic_receipt()`); }
    expect((await handler()(httpRequest("bookings", "staff", value))).status).toBe(200);
  });
  it("records no consent or notification job for a staff-created booking", async () => {
    const integrated = createBookingService(database.db, { ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient) }, protection, clock, whatsappBookingEvents);
    const integratedHandler = createClinicBookingHandler(() => integrated, () => baseURL);
    const response = await integratedHandler(httpRequest("bookings", "staff", clinicInput()));
    expect(response.status).toBe(200);
    const { receipt } = await response.json();
    expect(await database.db.select().from(whatsappConsents).where(eq(whatsappConsents.appointmentId, receipt.id))).toMatchObject([{ consented: false }]);
    expect(await database.db.select().from(whatsappNotifications).where(eq(whatsappNotifications.appointmentId, receipt.id))).toEqual([]);
  });
  it("returns setup/empty availability and redacts configuration failures", async () => {
    await schedule.saveOverride(credentials.admin, { date, mode: "closed" });
    expect(await (await times()(httpRequest(`booking-availability?date=${date}`, "staff"))).json()).toMatchObject({ configured: true, closed: true, slots: [] });
    const broken = createClinicBookingHandler(() => { throw new Error("private key value"); }, () => baseURL);
    const response = await broken(httpRequest("bookings", "staff", clinicInput()));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private key");
    await database.db.delete(clinicSettings);
    expect(await (await times()(httpRequest("booking-availability", "staff"))).json()).toMatchObject({ configured: false, slots: [] });
  });
});


describe("local clinic booking email simulation", () => {
  const source = { NODE_ENV: "test", APP_URL: baseURL };
  const withEmail = (enabled = true) => createBookingService(database.db, { ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient) }, protection, clock, localEmailBookingEvents(enabled));
  it("logs only after commit, snapshots the template and deduplicates concurrent retries", async () => {
    const integrated = withEmail(), value = clinicInput();
    const receipt = await integrated.bookForClinic(credentials.staff, value);
    const [job] = await database.db.select().from(localBookingEmails);
    expect(job.loggedAt).toBeNull();
    expect(job.body).toContain("Booking Test");
    await database.db.update(clinicSettings).set({ name: "Changed clinic" });
    const log = vi.fn((message: string) => {
      expect(message).not.toContain(value.email);
      expect(message).not.toContain(value.name);
      expect(message).not.toContain(value.phone);
    });
    const deliver = createPostBookingLocalEmail(() => database.db, source, log);
    await Promise.all([deliver(receipt), deliver(receipt)]);
    const replay = await integrated.bookForClinic(credentials.staff, value);
    expect(replay).toEqual(receipt);
    await deliver(replay);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ event: "booking_email_simulated", delivery: "simulated email sent — no real email sent", body: job.body });
    expect((await database.db.select().from(localBookingEmails))[0].loggedAt).toBeInstanceOf(Date);
  });
  it("uses SMTP_HOST presence to disable simulation and reports deferred delivery safely", async () => {
    const smtpSource = { ...source, SMTP_HOST: "smtp.example.test" };
    const integrated = createBookingService(database.db, { ...identity.access, requirePatientAccess: createPatientBookingAccess(identity.patient) }, protection, clock, localEmailBookingEvents(localBookingEmailEnabled(smtpSource)));
    const log = vi.fn(), warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handler = createClinicBookingHandler(() => integrated, () => baseURL, createPostBookingLocalEmail(() => { throw new Error("must not connect"); }, smtpSource, log));
      expect((await handler(httpRequest("bookings", "staff", clinicInput()))).status).toBe(200);
      expect(await database.db.select().from(localBookingEmails)).toEqual([]);
      expect(log).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("SMTP_DELIVERY_UNAVAILABLE"));
      expect(warning.mock.calls.flat().join(" ")).not.toContain(smtpSource.SMTP_HOST);
    } finally { warning.mockRestore(); }
  });
  it("does not queue for patients or disabled mode", async () => {
    await withEmail().bookPatient(credentials.patient, input());
    await withEmail(false).bookForClinic(credentials.staff, clinicInput(`${date}T09:20:00Z`));
    expect(await database.db.select().from(localBookingEmails)).toEqual([]);
    const log = vi.fn();
    await createPostBookingLocalEmail(() => { throw new Error("must not connect"); }, {}, log)({ id: "unused" } as never);
    expect(log).not.toHaveBeenCalled();
  });
  it("preserves the successful HTTP receipt on log failure and recovers with the same request", async () => {
    const integrated = withEmail(), value = clinicInput(), warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = createPostBookingLocalEmail(() => database.db, source, () => { throw new Error("private error"); });
    try {
      const response = await createClinicBookingHandler(() => integrated, () => baseURL, broken)(httpRequest("bookings", "staff", value));
      expect(response.status).toBe(200);
      const { receipt } = await response.json();
      expect((await database.db.select().from(localBookingEmails))[0].loggedAt).toBeNull();
      const log = vi.fn();
      const retry = await createClinicBookingHandler(() => integrated, () => baseURL, createPostBookingLocalEmail(() => database.db, source, log))(httpRequest("bookings", "staff", value));
      expect((await retry.json()).receipt).toEqual(receipt);
      expect(log).toHaveBeenCalledTimes(1);
      expect(await counts()).toEqual([1, 1, 1, 1]);
      expect(warn).toHaveBeenCalledWith(expect.not.stringContaining("private error"));
    } finally { warn.mockRestore(); }
  });
  it.each([false, true])("rolls back the email job with booking on immediate/deferred failure (%s)", async (deferred) => {
    await database.db.execute(sql`CREATE FUNCTION reject_local_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$`);
    await database.db.execute(sql.raw(`CREATE ${deferred ? "CONSTRAINT" : ""} TRIGGER reject_local_email ${deferred ? "AFTER" : "BEFORE"} INSERT ON local_booking_emails ${deferred ? "DEFERRABLE INITIALLY DEFERRED" : ""} FOR EACH ROW EXECUTE FUNCTION reject_local_email()`));
    const integrated = withEmail(), value = clinicInput(), log = vi.fn();
    try {
      const handler = createClinicBookingHandler(() => integrated, () => baseURL, createPostBookingLocalEmail(() => database.db, source, log));
      expect((await handler(httpRequest("bookings", "staff", value))).status).toBe(503);
      expect(await counts()).toEqual([0, 0, 0, 0]);
      expect(await database.db.select().from(localBookingEmails)).toEqual([]);
      expect(log).not.toHaveBeenCalled();
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_local_email ON local_booking_emails`);
      await database.db.execute(sql`DROP FUNCTION reject_local_email()`);
    }
    await integrated.bookForClinic(credentials.staff, value);
    expect(await database.db.select().from(localBookingEmails)).toHaveLength(1);
  });
});
