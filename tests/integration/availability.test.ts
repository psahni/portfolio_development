import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@/db/connection";
import { clinicSettings } from "@/db/schema/clinic";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { patientUser, staffAccess, staffUser } from "@/db/schema/auth";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import { createIdentity } from "@/modules/identity/create-auth";
import { unconfiguredMailer } from "@/platform/mail";
import { createClinicService } from "@/modules/clinic/service";
import { emptyConfiguration, type ClinicConfiguration } from "@/modules/clinic/configuration";
import { createSchedulingService } from "@/modules/scheduling/service";
import { createSchedulingHandler } from "@/modules/scheduling/http";

const baseURL = "http://localhost:3000", date = "2026-11-10", clock = () => new Date("2026-11-09T08:00Z");
let database: ReturnType<typeof createDatabase>;
let clinic: ReturnType<typeof createClinicService>;
let service: ReturnType<typeof createSchedulingService>;
let handle: ReturnType<typeof createSchedulingHandler>;
let access: ReturnType<typeof createIdentity>["access"];
const credentials: Record<string, Headers> = { anonymous: new Headers() };
function configuration(): ClinicConfiguration {
  const value = { ...emptyConfiguration(), clinicName: "Scheduling Test", doctorName: "Synthetic Doctor", timezone: "UTC" };
  value.weeklyHours.forEach((day) => { day.intervals = [{ start: "09:00", end: "12:00" }]; });
  return value;
}
function headers(response: Response) {
  expect(response.status).toBe(200);
  return new Headers({ cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") });
}
function request(method: string, role = "admin", body?: object, origin = baseURL) {
  const copy = new Headers(credentials[role]); copy.set("origin", origin); copy.set("content-type", "application/json"); copy.set("x-user-role", "admin");
  return new Request(`${baseURL}/api/admin/availability?date=${date}`, { method, headers: copy, ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}) });
}
async function appointment(start = "09:20", end = "09:40") {
  const [row] = await database.db.insert(reservations).values({ doctorId: 1, kind: "appointment", startsAt: new Date(`${date}T${start}Z`), endsAt: new Date(`${date}T${end}Z`) }).returning();
  return row;
}
beforeAll(async () => {
  const url = new URL(inject("databaseUrl")), client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE availability_test"); } finally { await client.end(); }
  url.pathname = "/availability_test"; database = createDatabase(url.toString());
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  const email = "availability-doctor@example.test", staffSecret = "availability-staff-" + "b".repeat(48);
  await bootstrapAdmin(database.db, { email, name: "Synthetic Doctor", pin: "4821", staffSecret });
  const staffId = randomUUID();
  await database.db.insert(staffUser).values({ id: staffId, name: "Synthetic Staff", email: "availability-staff@example.test" });
  await database.db.insert(staffAccess).values({ userId: staffId, role: "staff" });
  await database.db.insert(patientUser).values({ id: randomUUID(), name: "Same-email patient", email });
  const identity = createIdentity({ db: database.db, baseURL, testMode: true, staffSecret, patientSecret: "availability-patient-" + "a".repeat(48), mailer: unconfiguredMailer });
  access = identity.access;
  credentials.admin = headers(await identity.staff.api.signInAdminPin({ body: { email, pin: "0000" }, asResponse: true }));
  for (const [role, address] of [["staff", "availability-staff@example.test"], ["patient", email]] as const) {
    await identity[role].api.sendVerificationOTP({ body: { email: address, type: "sign-in" } });
    credentials[role] = headers(await identity[role].api.signInEmailOTP({ body: { email: address, otp: "0000" }, asResponse: true }));
  }
  clinic = createClinicService(database.db, identity.access, clock);
  service = createSchedulingService(database.db, identity.access, clock);
  handle = createSchedulingHandler(() => service, () => baseURL);
});
beforeEach(async () => { await database.db.delete(clinicSettings); await clinic.save(credentials.admin, configuration()); });
afterAll(async () => { await database?.pool.end(); });

describe("persisted availability and transaction rules", () => {
  it("replays migrations and previews without reserving or inserting overrides", async () => {
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(9);
    expect(await database.db.select().from(reservations)).toHaveLength(0);
    expect(await database.db.select().from(dayOverrides)).toHaveLength(0);
  });
  it("requires clinic configuration without creating defaults", async () => {
    await database.db.delete(clinicSettings);
    expect((await service.preview(credentials.admin, date)).configured).toBe(false);
    await expect(service.saveOverride(credentials.admin, { date, mode: "closed" })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("persists a holiday and restores weekly hours without changing another date", async () => {
    await service.saveOverride(credentials.admin, { date, mode: "closed", reason: "Holiday" });
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(0);
    expect((await service.preview(credentials.admin, "2026-11-11")).slots).toHaveLength(9);
    await service.saveOverride(credentials.admin, { date, mode: "weekly" });
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(9);
    expect(await clinic.get(credentials.admin)).toEqual(configuration());
  });
  it("replaces a closed weekday with special hours, including split intervals", async () => {
    const value = configuration(); value.weeklyHours[1].intervals = []; await clinic.save(credentials.admin, value);
    await service.saveOverride(credentials.admin, { date, mode: "custom", intervals: [{ start: "14:00", end: "15:00" }, { start: "16:00", end: "17:00" }] });
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(6);
    expect((await clinic.get(credentials.admin))?.weeklyHours[1].intervals).toEqual([]);
  });
  it("stores breaks as UTC, excludes them and retains them when restoring weekly hours", async () => {
    const value = configuration(); value.timezone = "Asia/Kolkata"; await clinic.save(credentials.admin, value);
    await service.addBreak(credentials.admin, { date, start: "09:20", end: "09:40", reason: "Personal work" });
    const [block] = await database.db.select().from(reservations);
    expect(block.startsAt.toISOString()).toBe(`${date}T03:50:00.000Z`);
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(8);
    await service.saveOverride(credentials.admin, { date, mode: "closed" });
    await service.saveOverride(credentials.admin, { date, mode: "weekly" });
    expect((await service.preview(credentials.admin, date)).blocks).toHaveLength(1);
    await service.removeBreak(credentials.admin, { date, id: block.id });
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(9);
  });
  it("serializes simultaneous conflicting breaks and retains only one", async () => {
    const value = { date, start: "10:00", end: "11:00" };
    const results = await Promise.allSettled([service.addBreak(credentials.admin, value), service.addBreak(credentials.admin, value)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    expect(await database.db.select().from(reservations)).toHaveLength(1);
  });
  it("enforces non-overlap in PostgreSQL even when callers skip the service lock", async () => {
    const values = { doctorId: 1, kind: "block" as const, startsAt: new Date(`${date}T10:00Z`), endsAt: new Date(`${date}T11:00Z`) };
    const results = await Promise.allSettled([database.db.insert(reservations).values(values), database.db.insert(reservations).values(values)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(database.db.insert(reservations).values({ ...values, startsAt: values.endsAt, endsAt: new Date(`${date}T11:20Z`) })).resolves.toBeDefined();
    await expect(database.db.insert(reservations).values({ ...values, endsAt: values.startsAt })).rejects.toThrow();
    await expect(database.db.insert(reservations).values({ ...values, doctorId: 2 })).rejects.toThrow();
  });
  it("excludes booked occupancy and rejects overlapping breaks with safe conflict times", async () => {
    await appointment();
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(8);
    const response = await handle(request("POST", "admin", { date, start: "09:30", end: "10:00" }));
    expect(response.status).toBe(409);
    expect((await response.json()).conflicts).toEqual([{ kind: "appointment", startsAt: `${date}T09:20:00.000Z`, endsAt: `${date}T09:40:00.000Z` }]);
    expect(await database.db.select().from(reservations)).toHaveLength(1);
  });
  it("cannot remove an appointment or a break through an incorrect date", async () => {
    const booked = await appointment();
    await expect(service.removeBreak(credentials.admin, { date, id: booked.id })).rejects.toMatchObject({ statusCode: 404 });
    await service.addBreak(credentials.admin, { date, start: "10:00", end: "10:20" });
    const block = (await service.preview(credentials.admin, date)).blocks[0];
    await expect(service.removeBreak(credentials.admin, { date: "2026-11-11", id: block.id })).rejects.toMatchObject({ statusCode: 404 });
    expect(await database.db.select().from(reservations)).toHaveLength(2);
  });
  it("rolls back a holiday or special hours that would invalidate an appointment", async () => {
    await appointment();
    for (const input of [{ date, mode: "closed" }, { date, mode: "custom", intervals: [{ start: "10:00", end: "12:00" }] }]) {
      await expect(service.saveOverride(credentials.admin, input)).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await database.db.select().from(dayOverrides)).toHaveLength(0);
    expect((await service.preview(credentials.admin, date)).slots).toHaveLength(8);
  });
  it("preserves a special-hours override if restoring weekly hours would invalidate a booking", async () => {
    await service.saveOverride(credentials.admin, { date, mode: "custom", intervals: [{ start: "14:00", end: "16:00" }] });
    await appointment("14:00", "14:20");
    await expect(service.saveOverride(credentials.admin, { date, mode: "weekly" })).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.preview(credentials.admin, date)).override?.mode).toBe("custom");
  });
  it("rolls back clinic edits that exclude existing bookings while honoring booked snapshots", async () => {
    await appointment(); const value = configuration(); value.clinicName = "Must roll back"; value.weeklyHours[1].intervals = [];
    await expect(clinic.save(credentials.admin, value)).rejects.toMatchObject({ statusCode: 409 });
    expect(await clinic.get(credentials.admin)).toEqual(configuration());
    const timezone = { ...configuration(), timezone: "Asia/Kolkata" };
    await expect(clinic.save(credentials.admin, timezone)).rejects.toMatchObject({ statusCode: 409 });
    await clinic.save(credentials.admin, { ...configuration(), durationMinutes: 30, bufferAfterMinutes: 5 });
    expect(await database.db.select().from(reservations)).toHaveLength(1);
  });
  it("serializes a competing holiday and appointment occupancy change on the doctor row", async () => {
    // Models the upcoming booking transaction's shared lock and availability recheck.
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void; const ready = new Promise<void>((resolve) => { locked = resolve; });
    const booking = database.db.transaction(async (tx) => {
      await tx.execute("SELECT id FROM doctor_profile WHERE id = 1 FOR UPDATE"); locked(); await gate;
      await tx.insert(reservations).values({ doctorId: 1, kind: "appointment", startsAt: new Date(`${date}T09:00Z`), endsAt: new Date(`${date}T09:20Z`) });
    });
    await ready;
    const holiday = service.saveOverride(credentials.admin, { date, mode: "closed" });
    release(); await booking;
    await expect(holiday).rejects.toMatchObject({ statusCode: 409 });
    expect(await database.db.select().from(dayOverrides)).toHaveLength(0);
  });
});

describe("availability HTTP validation and access", () => {
  it("serves private uncached previews and applies valid mutations", async () => {
    const response = await handle(request("GET")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).availability.slots).toHaveLength(9);
    expect((await handle(request("PUT", "admin", { date, mode: "closed" }))).status).toBe(200);
  });
  it.each([["anonymous", 401], ["staff", 403], ["patient", 401]] as const)("rejects %s for every operation despite claimed admin role", async (role, status) => {
    for (const method of ["GET", "PUT", "POST", "DELETE"]) expect((await handle(request(method, role, { date, mode: "closed", start: "10:00", end: "11:00", id: randomUUID() }))).status).toBe(status);
    expect(await database.db.select().from(dayOverrides)).toHaveLength(0);
    expect(await database.db.select().from(reservations)).toHaveLength(0);
  });
  it("rejects invalid dates, overlaps, reversed times, forged origins and malformed JSON", async () => {
    for (const input of [{ date: "2026-02-30", mode: "closed" }, { date: "2026-11-08", mode: "closed" }, { date: "2027-11-10", mode: "closed" }, { date, mode: "custom", intervals: [{ start: "10:00", end: "11:00" }, { start: "10:30", end: "12:00" }] }]) expect((await handle(request("PUT", "admin", input))).status).toBe(400);
    expect((await handle(request("POST", "admin", { date, start: "11:00", end: "10:00" }))).status).toBe(400);
    expect((await handle(request("PUT", "admin", { date, mode: "closed" }, "https://evil.example.test"))).status).toBe(403);
    const original = request("PUT"); expect((await handle(new Request(original.url, { method: "PUT", headers: original.headers, body: "{" }))).status).toBe(400);
    expect(await database.db.select().from(dayOverrides)).toHaveLength(0);
  });
  it("allows future override dates beyond the booking window but returns no slots", async () => {
    await service.saveOverride(credentials.admin, { date: "2027-01-01", mode: "closed" });
    expect((await service.preview(credentials.admin, "2027-01-01")).outsideWindow).toBe(true);
  });
  it("rejects nonexistent and ambiguous explicit DST times", async () => {
    await clinic.save(credentials.admin, { ...configuration(), timezone: "America/New_York" });
    await expect(service.addBreak(credentials.admin, { date: "2027-03-14", start: "02:00", end: "03:00" })).rejects.toMatchObject({ statusCode: 400 });
    // Next fold is in range from the injected clock, unlike the already-past 2026 fold.
    const future = createSchedulingService(database.db, access, () => new Date("2027-10-01T00:00Z"));
    await expect(future.saveOverride(credentials.admin, { date: "2027-11-07", mode: "custom", intervals: [{ start: "01:00", end: "02:00" }] })).rejects.toMatchObject({ statusCode: 400 });
  });
});
