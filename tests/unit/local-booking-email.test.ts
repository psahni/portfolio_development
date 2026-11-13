import { describe, expect, it } from "vitest";
import { bookingEmailTemplate, localBookingEmailEnabled } from "@/modules/notifications/local-booking-email";

const source = { NODE_ENV: "development", APP_URL: "http://localhost:3000" };
describe("local booking email", () => {
  it("uses absent/blank SMTP_HOST for local development/test fallback", () => {
    expect(localBookingEmailEnabled({})).toBe(false);
    expect(localBookingEmailEnabled(source)).toBe(true);
    expect(localBookingEmailEnabled({ ...source, SMTP_HOST: "" })).toBe(true);
    expect(localBookingEmailEnabled({ ...source, SMTP_HOST: "  " })).toBe(true);
    expect(localBookingEmailEnabled({ ...source, SMTP_HOST: "smtp.example.test" })).toBe(false);
    expect(localBookingEmailEnabled({ ...source, NODE_ENV: "test", APP_URL: "http://[::1]:3000" })).toBe(true);
    for (const overrides of [{ NODE_ENV: "production" }, { APP_URL: "https://clinic.example" }, { APP_URL: "http://localhost.example" }, { APP_URL: "file://localhost" }, { APP_URL: "http://user:secret@localhost" }]) {
      expect(localBookingEmailEnabled({ ...source, ...overrides })).toBe(false);
    }
  });
  it("formats the booked timezone and clinic contact instructions without patient PII", () => {
    const message = bookingEmailTemplate({ id: "reference", status: "confirmed", startsAt: "2026-11-10T09:00:00Z", endsAt: "2026-11-10T09:20:00Z", timezone: "Asia/Kolkata", durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      { clinicName: "Test Clinic", doctorName: "Test Doctor", email: "clinic@example.test", phone: "+91 1234567890" });
    expect(message.subject).toBe("Appointment confirmed — Test Clinic");
    for (const value of ["Test Doctor", "10 November 2026", "14:30", "Asia/Kolkata", "reference", "clinic@example.test", "+91 1234567890"]) expect(message.body).toContain(value);
  });
});
