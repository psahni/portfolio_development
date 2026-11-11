import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, inject, it } from "vitest";
import { createDatabase } from "@/db/connection";
import { whatsappConsents, whatsappNotifications, whatsappAttempts } from "@/db/schema/notifications";
import { appointments, bookingRequests } from "@/db/schema/booking";
import { createContactProtection } from "@/modules/booking/contact-protection";

it("upgrades existing confirmed/cancelled history through 0008 without changing contacts, receipts or overlap protection", async () => {
  const url = new URL(inject("databaseUrl")), client = new Client({ connectionString: url.toString() });
  try { await client.connect(); await client.query("CREATE DATABASE doctor_upgrade_test"); } finally { await client.end(); }
  url.pathname = "/doctor_upgrade_test";
  const database = createDatabase(url.toString());
  // A separate synthetic database starts at the exact pre-feature migration state.
  const folder = await mkdtemp(join(tmpdir(), "nuvortiq-doctor-migrations-"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 5);
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
  try {
    await migrate(database.db, { migrationsFolder: folder });
    const id = randomUUID(), cancelled = randomUUID(), patient = randomUUID(), reservation = randomUUID(), request = randomUUID();
    const protection = createContactProtection(randomBytes(32).toString("base64"));
    const contact = { name: "Synthetic Existing Patient", email: "existing@example.test", phone: "+919876543210" };
    const encrypted = protection.encrypt(id, contact);
    await database.pool.query("INSERT INTO patient_auth.\"user\" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,'Synthetic Existing Patient','existing@example.test',true,now(),now())", [patient]);
    await database.pool.query("INSERT INTO clinic_settings (id,name,timezone) VALUES (1,'Migration Test','UTC')");
    await database.pool.query("INSERT INTO doctor_profile (id,name) VALUES (1,'Synthetic Doctor')");
    await database.pool.query("INSERT INTO reservations (id,doctor_id,kind,starts_at,ends_at) VALUES ($1,1,'appointment','2026-12-01T09:00Z','2026-12-01T09:20Z')", [reservation]);
    for (const [appointment, status, occupancy, ciphertext] of [[id, "confirmed", reservation, encrypted], [cancelled, "cancelled", null, protection.encrypt(cancelled, contact)]]) {
      await database.pool.query("INSERT INTO appointments (id,doctor_id,reservation_id,patient_user_id,source,status,contact_ciphertext,starts_at,ends_at,timezone,duration_minutes,buffer_before_minutes,buffer_after_minutes) VALUES ($1,1,$2,$3,'patient',$4,$5,'2026-12-01T09:00Z','2026-12-01T09:20Z','UTC',20,0,0)", [appointment, occupancy, patient, status, ciphertext]);
    }
    await database.pool.query("INSERT INTO booking_audit (appointment_id,action,actor_kind,actor_id) VALUES ($1,'created','patient',$2),($3,'cancelled','patient',$2)", [id, patient, cancelled]);
    const receipt = { id, status: "confirmed", startsAt: "2026-12-01T09:00:00.000Z", endsAt: "2026-12-01T09:20:00.000Z", timezone: "UTC", durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await database.pool.query("INSERT INTO booking_requests (actor_kind,actor_id,request_id,fingerprint,appointment_id,receipt,expires_at) VALUES ('patient',$1,$2,'existing-receipt',$3,$4,now()+interval '24 hours')", [patient, request, id, JSON.stringify(receipt)]);
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    const [upgraded] = await database.db.select().from(appointments).where(eq(appointments.id, id));
    expect(upgraded).toMatchObject({ status: "confirmed", reservationId: reservation, contactCiphertext: encrypted, cancelledByStaffId: null, cancelledAt: null, cancellationReason: null, rebookingInstruction: null, originalTimeBlocked: false });
    expect(protection.decrypt(id, upgraded.contactCiphertext)).toEqual(contact);
    expect((await database.db.select().from(appointments).where(eq(appointments.id, cancelled)))[0]).toMatchObject({ status: "cancelled", reservationId: null, cancelledByStaffId: null, patientCancelledAt: null, patientCancellationLate: null });
    expect((await database.db.select().from(bookingRequests))[0].receipt).toEqual(receipt);
    for (const table of [whatsappConsents, whatsappNotifications, whatsappAttempts]) expect(await database.db.select().from(table)).toHaveLength(0);
    expect((await database.db.execute(sql`select conname from pg_constraint where conname = 'reservation_no_overlap'`)).rows).toHaveLength(1);
    await expect(database.pool.query("INSERT INTO reservations (doctor_id,kind,starts_at,ends_at) VALUES (1,'block','2026-12-01T09:05Z','2026-12-01T09:15Z')")).rejects.toMatchObject({ code: "23P01" });
    await expect(database.db.update(appointments).set({ cancelledAt: new Date() }).where(eq(appointments.id, id))).rejects.toThrow();
  } finally { await database.pool.end(); }
});
