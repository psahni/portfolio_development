import { describe, expect, it } from "vitest";
import { configurationSchema, emptyConfiguration, toMinutes, toTime, type ClinicConfiguration } from "@/modules/clinic/configuration";

function valid(): ClinicConfiguration {
  return { ...emptyConfiguration(), clinicName: "Demo Clinic", doctorName: "Demo Doctor", timezone: "Asia/Kolkata" };
}

describe("clinic configuration", () => {
  it("starts closed with explicit timezone selection and the agreed appointment defaults", () => {
    const initial = emptyConfiguration();
    expect(initial.timezone).toBe("");
    expect(initial.weeklyHours.every((day) => day.intervals.length === 0)).toBe(true);
    expect(initial).toMatchObject({ durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minLeadMinutes: 60, bookingHorizonDays: 30 });
    expect(configurationSchema.safeParse(initial).success).toBe(false);
  });

  it("normalizes contact details and accepts a fully closed week", () => {
    const input = { ...valid(), clinicName: " Demo Clinic ", doctorName: " Demo Doctor ", email: " HELP@EXAMPLE.TEST ", phone: " +91 12345 67890 " };
    expect(configurationSchema.parse(input)).toMatchObject({ clinicName: "Demo Clinic", doctorName: "Demo Doctor", email: "help@example.test", phone: "+91 12345 67890" });
  });

  it.each(["", "Mars/Base", "EST", "UTC+05:30"])("rejects an unset or unsupported timezone: %s", (timezone) => {
    expect(configurationSchema.safeParse({ ...valid(), timezone }).success).toBe(false);
  });

  it.each(["UTC", "Asia/Kolkata", "America/New_York"])("accepts the IANA timezone %s", (timezone) => {
    expect(configurationSchema.safeParse({ ...valid(), timezone }).success).toBe(true);
  });

  it("accepts adjacent intervals and unsorted non-overlapping intervals", () => {
    const value = valid();
    value.weeklyHours[0].intervals = [{ start: "13:00", end: "17:00" }, { start: "09:00", end: "13:00" }];
    expect(configurationSchema.safeParse(value).success).toBe(true);
  });

  it("rejects overlapping intervals even when entered out of order", () => {
    const value = valid();
    value.weeklyHours[0].intervals = [{ start: "13:00", end: "17:00" }, { start: "09:00", end: "14:00" }];
    expect(() => configurationSchema.parse(value)).toThrow("Monday hours must not overlap");
  });

  it.each([["09:00", "09:00"], ["17:00", "09:00"], ["22:00", "02:00"]])("rejects zero-length/reversed/overnight hours %s–%s", (start, end) => {
    const value = valid(); value.weeklyHours[0].intervals = [{ start, end }];
    expect(configurationSchema.safeParse(value).success).toBe(false);
  });

  it.each(["24:00", "9:00", "12:99", "09:30:00", ""])("rejects invalid wall-clock times: %s", (start) => {
    const value = valid(); value.weeklyHours[0].intervals = [{ start, end: "23:59" }];
    expect(configurationSchema.safeParse(value).success).toBe(false);
  });

  it("requires each weekday exactly once", () => {
    const value = valid();
    expect(configurationSchema.safeParse({ ...value, weeklyHours: value.weeklyHours.slice(0, 6) }).success).toBe(false);
    value.weeklyHours[6].day = 0;
    expect(configurationSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["durationMinutes", 5, 240], ["bufferBeforeMinutes", 0, 120], ["bufferAfterMinutes", 0, 120],
    ["minLeadMinutes", 0, 10080], ["bookingHorizonDays", 1, 365],
  ] as const)("enforces whole-number boundaries for %s", (field, min, max) => {
    for (const value of [min, max]) expect(configurationSchema.safeParse({ ...valid(), [field]: value }).success).toBe(true);
    for (const value of [min - 1, max + 1, min + 0.5, NaN]) expect(configurationSchema.safeParse({ ...valid(), [field]: value }).success).toBe(false);
  });

  it("rejects missing names and malformed contacts", () => {
    for (const input of [{ clinicName: " " }, { doctorName: " " }, { email: "not-an-email" }, { phone: "-----" }, { phone: "call me" }]) {
      expect(configurationSchema.safeParse({ ...valid(), ...input }).success).toBe(false);
    }
  });

  it("stores local minutes without converting them to UTC", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toTime(570)).toBe("09:30");
    expect(toTime(1439)).toBe("23:59");
  });
});
