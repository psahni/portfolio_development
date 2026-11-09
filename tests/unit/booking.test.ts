import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContactProtection } from "@/modules/booking/contact-protection";
import { clinicBookingSchema, patientBookingSchema } from "@/modules/booking/models";

const key = randomBytes(32).toString("base64");
const contact = { name: "Synthetic Patient", email: "patient@example.test", phone: "+919876543210" };

describe("booking contact protection", () => {
  it("round-trips with randomized ciphertext and keeps contact values out of stored data", () => {
    const protection = createContactProtection(key), id = randomUUID();
    const first = protection.encrypt(id, contact), second = protection.encrypt(id, contact);
    expect(first).not.toBe(second);
    for (const value of Object.values(contact)) expect(first).not.toContain(value);
    expect(protection.decrypt(id, first)).toEqual(contact);
    expect(protection.decrypt(id, second)).toEqual(contact);
  });
  it("rejects tampering, another appointment ID and another encryption key", () => {
    const protection = createContactProtection(key), id = randomUUID(), encrypted = protection.encrypt(id, contact);
    const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64");
    for (const read of [() => protection.decrypt(id, parts.join(".")), () => protection.decrypt(randomUUID(), encrypted),
      () => createContactProtection(randomBytes(32).toString("base64")).decrypt(id, encrypted), () => protection.decrypt(id, "invalid")]) {
      expect(read).toThrow("Unable to read protected appointment contacts.");
    }
  });
  it.each([undefined, "", "x".repeat(32), randomBytes(31).toString("base64"), randomBytes(33).toString("base64")])("fails closed for an invalid key", (value) => {
    expect(() => createContactProtection(value)).toThrow("BOOKING_DATA_KEY");
  });
  it("protects duplicate-request fingerprints with a dedicated derived key", () => {
    const protection = createContactProtection(key), payload = JSON.stringify(contact);
    expect(protection.fingerprint(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(protection.fingerprint(payload)).toBe(protection.fingerprint(payload));
    expect(protection.fingerprint(payload)).not.toBe(protection.fingerprint(payload + " "));
    expect(protection.fingerprint(payload)).not.toBe(createContactProtection(randomBytes(32).toString("base64")).fingerprint(payload));
  });
});

describe("booking input validation", () => {
  const input = { requestId: randomUUID(), startsAt: "2026-11-10T14:30:00+05:30", ...contact };
  it("normalizes equivalent instants, contacts and phone formatting", () => {
    expect(clinicBookingSchema.parse({ ...input, name: " Synthetic Patient ", email: " PATIENT@example.test ", phone: "+91 (98765) 43210" }))
      .toEqual({ ...input, startsAt: "2026-11-10T09:00:00.000Z" });
  });
  it("rejects patient-supplied email, ownership, duration and roles", () => {
    const { email: _, ...patient } = input; void _;
    for (const extra of [{ email: contact.email }, { patientUserId: "another" }, { durationMinutes: 40 }, { role: "admin" }, { endsAt: input.startsAt }]) {
      expect(patientBookingSchema.safeParse({ ...patient, ...extra }).success).toBe(false);
    }
  });
  it.each([{ requestId: "invalid" }, { startsAt: "2026-11-10T09:00:00" }, { startsAt: "0000-11-10T09:00:00Z" }, { name: "" }, { name: "A\nB" },
    { email: "invalid" }, { phone: "1234" }, { phone: "1234567890123456" }, { phone: "call-me" }])("rejects invalid booking details", (change) => {
    expect(clinicBookingSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});
