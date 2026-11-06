import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@/db/connection";
import { clinicSettings, doctorProfile, weeklyHours } from "@/db/schema/clinic";
import { patientUser, staffAccess, staffUser } from "@/db/schema/auth";
import { bootstrapAdmin } from "@/modules/identity/admin-pin";
import { createIdentity } from "@/modules/identity/create-auth";
import { unconfiguredMailer } from "@/platform/mail";
import { createClinicService } from "@/modules/clinic/service";
import { createClinicHandler } from "@/modules/clinic/http";
import { emptyConfiguration, type ClinicConfiguration } from "@/modules/clinic/configuration";

const baseURL = "http://localhost:3000";
const adminEmail = "clinic-doctor@example.test";
let database: ReturnType<typeof createDatabase>;
let service: ReturnType<typeof createClinicService>;
let handle: ReturnType<typeof createClinicHandler>;
let adminId: string;
const credentials: Record<string, Headers> = { anonymous: new Headers() };

function configuration(): ClinicConfiguration {
  const settings = { ...emptyConfiguration(), clinicName: "Demo Clinic", doctorName: "Demo Doctor", timezone: "Asia/Kolkata", email: "clinic@example.test", phone: "+91 12345 67890" };
  settings.weeklyHours[0].intervals = [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }];
  return settings;
}

function sessionHeaders(response: Response) {
  expect(response.status).toBe(200);
  return new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
}

function request(method: string, headers: Headers, body?: object, origin = baseURL) {
  const copy = new Headers(headers);
  copy.set("origin", origin); copy.set("content-type", "application/json");
  return new Request(`${baseURL}/api/admin/settings`, { method, headers: copy, ...(body ? { body: JSON.stringify(body) } : {}) });
}

beforeAll(async () => {
  // Use a second database in the disposable cluster; the foundation suite owns its own auth fixtures.
  const url = new URL(inject("databaseUrl"));
  const client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE clinic_settings_test"); }
  finally { await client.end(); }
  url.pathname = "/clinic_settings_test";
  database = createDatabase(url.toString());
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  const staffSecret = "clinic-staff-" + "b".repeat(48);
  await bootstrapAdmin(database.db, { email: adminEmail, name: "Synthetic Doctor", pin: "4821", staffSecret });
  const [admin] = await database.db.select().from(staffAccess).where(eq(staffAccess.role, "admin")); adminId = admin.userId;
  const staffId = randomUUID();
  await database.db.insert(staffUser).values({ id: staffId, name: "Synthetic Staff", email: "clinic-staff@example.test" });
  await database.db.insert(staffAccess).values({ userId: staffId, role: "staff" });
  await database.db.insert(patientUser).values({ id: randomUUID(), name: "Same-email patient", email: adminEmail });
  const identity = createIdentity({ db: database.db, baseURL, testMode: true, staffSecret, patientSecret: "clinic-patient-" + "a".repeat(48), mailer: unconfiguredMailer });
  credentials.admin = sessionHeaders(await identity.staff.api.signInAdminPin({ body: { email: adminEmail, pin: "0000" }, asResponse: true }));
  for (const [role, email] of [["staff", "clinic-staff@example.test"], ["patient", adminEmail]] as const) {
    await identity[role].api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    credentials[role] = sessionHeaders(await identity[role].api.signInEmailOTP({ body: { email, otp: "0000" }, asResponse: true }));
  }
  service = createClinicService(database.db, identity.access);
  handle = createClinicHandler(() => service, () => baseURL);
});

beforeEach(async () => { await database.db.delete(clinicSettings); });
afterAll(async () => { await database?.pool.end(); });

describe("clinic settings persistence", () => {
  it("replays migrations and returns an unconfigured clinic without inserting defaults", async () => {
    await expect(migrate(database.db, { migrationsFolder: "./drizzle" })).resolves.toBeUndefined();
    expect(await service.get(credentials.admin)).toBeNull();
    expect(await database.db.select().from(doctorProfile)).toHaveLength(0);
  });

  it("saves and reloads names, contacts, timezone, rules and split hours", async () => {
    const value = configuration(); value.durationMinutes = 30; value.bufferBeforeMinutes = 5;
    value.bufferAfterMinutes = 10; value.minLeadMinutes = 90; value.bookingHorizonDays = 45;
    await service.save(credentials.admin, value);
    expect(await service.get(credentials.admin)).toEqual(value);
    const intervals = await database.db.select().from(weeklyHours);
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ doctorId: 1, day: 0, startMinute: 540, endMinute: 720 });
  });

  it("updates the singleton configuration and removes hours when a day is closed", async () => {
    await service.save(credentials.admin, configuration());
    const updated = { ...configuration(), clinicName: "Updated Clinic", weeklyHours: emptyConfiguration().weeklyHours };
    await service.save(credentials.admin, updated);
    expect(await service.get(credentials.admin)).toEqual(updated);
    expect(await database.db.select().from(clinicSettings)).toHaveLength(1);
    expect(await database.db.select().from(doctorProfile)).toHaveLength(1);
    expect(await database.db.select().from(weeklyHours)).toHaveLength(0);
  });

  it("preserves saved settings after invalid hours or an unset timezone", async () => {
    const before = configuration(); await service.save(credentials.admin, before);
    const invalid = configuration(); invalid.clinicName = "Should not save";
    invalid.weeklyHours[0].intervals[1].start = "11:00";
    await expect(service.save(credentials.admin, invalid)).rejects.toThrow("must not overlap");
    await expect(service.save(credentials.admin, { ...before, timezone: "" })).rejects.toThrow("timezone");
    expect(await service.get(credentials.admin)).toEqual(before);
  });

  it("rolls back clinic, doctor and deleted hours when a later database write fails", async () => {
    const before = configuration(); await service.save(credentials.admin, before);
    await database.db.execute(sql`ALTER TABLE weekly_hours ADD CONSTRAINT simulate_save_failure CHECK (day <> 2)`);
    try {
      const changed = configuration(); changed.clinicName = "Must roll back"; changed.durationMinutes = 45;
      changed.weeklyHours[2].intervals = [{ start: "09:00", end: "10:00" }];
      await expect(service.save(credentials.admin, changed)).rejects.toThrow();
      expect(await service.get(credentials.admin)).toEqual(before);
    } finally { await database.db.execute(sql`ALTER TABLE weekly_hours DROP CONSTRAINT simulate_save_failure`); }
  });

  it("keeps concurrent whole-schedule saves intact rather than combining their intervals", async () => {
    const a = configuration(); a.clinicName = "Schedule A"; a.durationMinutes = 30;
    const b = configuration(); b.clinicName = "Schedule B"; b.durationMinutes = 45;
    b.weeklyHours[0].intervals = [{ start: "15:00", end: "18:00" }];
    await Promise.all([service.save(credentials.admin, a), service.save(credentials.admin, b)]);
    expect([a, b]).toContainEqual(await service.get(credentials.admin));
  });

  it("enforces singleton, rule bounds and valid weekday/time intervals in PostgreSQL", async () => {
    await service.save(credentials.admin, configuration());
    await expect(database.db.insert(clinicSettings).values({ id: 2, name: "Second clinic", timezone: "UTC" })).rejects.toThrow();
    await expect(database.db.insert(doctorProfile).values({ id: 2, name: "Second doctor" })).rejects.toThrow();
    await expect(database.db.update(doctorProfile).set({ durationMinutes: 0 })).rejects.toThrow();
    await expect(database.db.insert(weeklyHours).values({ doctorId: 1, day: 7, startMinute: 600, endMinute: 660 })).rejects.toThrow();
    await expect(database.db.insert(weeklyHours).values({ doctorId: 1, day: 1, startMinute: 900, endMinute: 800 })).rejects.toThrow();
    expect(await service.get(credentials.admin)).toEqual(configuration());
  });
});

describe("clinic settings HTTP and authorization", () => {
  it("allows admin read/write with private, non-cached responses", async () => {
    const saved = await handle(request("PUT", credentials.admin, configuration()));
    expect(saved.status).toBe(200);
    const response = await handle(request("GET", credentials.admin));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ settings: configuration() });
  });

  it.each([["anonymous", 401], ["staff", 403], ["patient", 401]] as const)("rejects %s reads/writes and ignores client role claims", async (role, status) => {
    const headers = new Headers(credentials[role]); headers.set("x-user-role", "admin");
    for (const method of ["GET", "PUT"]) {
      expect((await handle(request(method, headers, method === "PUT" ? configuration() : undefined))).status).toBe(status);
    }
    expect(await service.get(credentials.admin)).toBeNull();
  });

  it("rejects a disabled admin's existing session", async () => {
    await database.db.update(staffAccess).set({ active: false }).where(eq(staffAccess.userId, adminId));
    try {
      expect((await handle(request("GET", credentials.admin))).status).toBe(403);
      expect((await handle(request("PUT", credentials.admin, configuration()))).status).toBe(403);
    } finally { await database.db.update(staffAccess).set({ active: true }).where(eq(staffAccess.userId, adminId)); }
  });

  it("rejects invalid configuration, malformed JSON and forged origins without saving", async () => {
    expect((await handle(request("PUT", credentials.admin, { ...configuration(), timezone: "Invalid/Zone" }))).status).toBe(400);
    const bad = request("PUT", credentials.admin, configuration());
    expect((await handle(new Request(bad.url, { method: "PUT", headers: bad.headers, body: "{" }))).status).toBe(400);
    expect((await handle(request("PUT", credentials.admin, configuration(), "https://other.example.test"))).status).toBe(403);
    expect(await service.get(credentials.admin)).toBeNull();
  });
});
