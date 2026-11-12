import { describe, expect, it } from "vitest";
import { emptyConfiguration, type ClinicConfiguration } from "@/modules/clinic/configuration";
import { addDays, clinicDate, dayBounds, generateSlotChoices, generateSlots, localInstant, occupancyFits } from "@/modules/scheduling/engine";
import { breakSchema, dateSchema, overrideSchema, type DateOverride, type Occupancy } from "@/modules/scheduling/models";

const date = "2026-11-09", now = new Date("2026-11-09T08:00:00Z");
function config(): ClinicConfiguration {
  const value = { ...emptyConfiguration(), clinicName: "Demo", doctorName: "Doctor", timezone: "UTC" };
  value.weeklyHours.forEach((day) => { day.intervals = [{ start: "09:00", end: "12:00" }]; });
  return value;
}
const occupancy = (start: string, end: string, kind: Occupancy["kind"] = "block"): Occupancy => ({ kind, startsAt: new Date(start), endsAt: new Date(end) });

describe("available-slot rules", () => {
  it("uses the duration grid, includes exact lead-time boundaries and fits closing time", () => {
    const slots = generateSlots(config(), date, null, [], now);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toMatchObject({ startsAt: "2026-11-09T09:00:00.000Z", endsAt: "2026-11-09T09:20:00.000Z", label: "9:00 AM – 9:20 AM" });
    expect(slots.at(-1)?.endsAt).toBe("2026-11-09T12:00:00.000Z");
    expect(generateSlots(config(), date, null, [], new Date(now.getTime() + 1))[0].startsAt).toBe("2026-11-09T09:20:00.000Z");
  });

  it("fits both buffers inside opening hours and includes them in slot spacing", () => {
    const value = config(); value.bufferBeforeMinutes = 5; value.bufferAfterMinutes = 5;
    value.weeklyHours[0].intervals = [{ start: "09:00", end: "10:00" }];
    const slots = generateSlots(value, date, null, [], now);
    expect(slots.map((slot) => slot.label)).toEqual(["9:05 AM – 9:25 AM", "9:35 AM – 9:55 AM"]);
    expect(slots[0]).toMatchObject({ occupiedStart: "2026-11-09T09:00:00.000Z", occupiedEnd: "2026-11-09T09:30:00.000Z" });
  });

  it("keeps lunch gaps unavailable and does not cross from one session to another", () => {
    const value = config(); value.weeklyHours[0].intervals = [{ start: "09:00", end: "10:00" }, { start: "11:00", end: "12:00" }];
    expect(generateSlots(value, date, null, [], now).map((slot) => slot.label)).toEqual(["9:00 AM – 9:20 AM", "9:20 AM – 9:40 AM", "9:40 AM – 10:00 AM", "11:00 AM – 11:20 AM", "11:20 AM – 11:40 AM", "11:40 AM – 12:00 PM"]);
  });

  it.each(["block", "appointment"] as const)("excludes %s occupancy while allowing touching endpoints", (kind) => {
    const occupied = [occupancy("2026-11-09T09:20Z", "2026-11-09T09:40Z", kind)];
    const slots = generateSlots(config(), date, null, occupied, now);
    expect(slots.some((slot) => slot.startsAt === "2026-11-09T09:20:00.000Z")).toBe(false);
    expect(slots.some((slot) => slot.startsAt === "2026-11-09T09:00:00.000Z")).toBe(true);
    expect(slots.some((slot) => slot.startsAt === "2026-11-09T09:40:00.000Z")).toBe(true);
  });

  it("excludes slots when only a buffer overlaps a break", () => {
    const value = config(); value.bufferBeforeMinutes = 5; value.bufferAfterMinutes = 5;
    const slots = generateSlots(value, date, null, [occupancy("2026-11-09T09:25Z", "2026-11-09T09:35Z")], now);
    expect(slots[0].label).toBe("10:05 AM – 10:25 AM");
  });

  it("replaces weekly hours with a holiday or special hours for only that date", () => {
    const closed: DateOverride = { mode: "closed", intervals: [], reason: "Holiday" };
    const custom: DateOverride = { mode: "custom", intervals: [{ start: "14:00", end: "15:00" }], reason: "Late opening" };
    expect(generateSlots(config(), date, closed, [], now)).toEqual([]);
    expect(generateSlots(config(), date, custom, [], now)[0].label).toBe("2:00 PM – 2:20 PM");
    expect(generateSlots(config(), addDays(date, 1), null, [], now)[0].label).toBe("9:00 AM – 9:20 AM");
  });

  it("applies minimum notice to visit starts without moving the slot grid", () => {
    const slots = generateSlots(config(), date, null, [], new Date("2026-11-09T08:30Z"));
    expect(slots[0].label).toBe("9:40 AM – 10:00 AM");
  });

  it("allows starts at the exact rolling booking-window boundary and rejects later/past dates", () => {
    const value = config(); value.bookingHorizonDays = 1;
    expect(generateSlots(value, "2026-11-10", null, [], new Date("2026-11-09T09:20Z")).map((slot) => slot.label)).toEqual(["9:00 AM – 9:20 AM", "9:20 AM – 9:40 AM"]);
    expect(generateSlots(value, "2026-11-11", null, [], now)).toEqual([]);
    expect(generateSlots(value, "2026-11-08", null, [], now)).toEqual([]);
  });

  it("keeps existing booked duration/buffer snapshots when new appointment rules change", () => {
    const value = config(); value.durationMinutes = 90;
    const booked = occupancy("2026-11-09T09:00Z", "2026-11-09T09:30Z", "appointment");
    expect(occupancyFits(value, null, booked)).toBe(true);
    expect(occupancyFits(value, { mode: "closed", intervals: [], reason: "" }, booked)).toBe(false);
    value.weeklyHours[0].intervals = [{ start: "10:00", end: "12:00" }];
    expect(occupancyFits(value, null, booked)).toBe(false);
  });
});

describe("clinic-local dates and daylight saving", () => {
  it("uses the clinic date rather than the server date and handles leap dates", () => {
    expect(clinicDate(new Date("2026-11-09T23:00Z"), "Asia/Kolkata")).toBe("2026-11-10");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(dayBounds("2026-11-09", "Asia/Kolkata").start.toISOString()).toBe("2026-11-08T18:30:00.000Z");
  });

  it("uses actual 23/25-hour day boundaries during clock changes", () => {
    const spring = dayBounds("2026-03-08", "America/New_York"), fall = dayBounds("2026-11-01", "America/New_York");
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600000);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600000);
  });

  it.each([["2026-03-08", "02:30"], ["2026-11-01", "01:30"]])("rejects an explicit nonexistent/ambiguous local time %s %s", (date, time) => {
    expect(() => localInstant(date, time, "America/New_York")).toThrow("ambiguous or does not exist");
  });

  it.each(["2026-03-08", "2026-11-01"])("never shifts or duplicates ambiguous/gap slots on %s", (date) => {
    const value = config(); value.timezone = "America/New_York"; value.minLeadMinutes = 0; value.durationMinutes = 30;
    value.weeklyHours[6].intervals = [{ start: "00:00", end: "04:00" }];
    const slots = generateSlots(value, date, null, [], new Date(`${addDays(date, -1)}T12:00Z`));
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((slot) => slot.startsAt)).size).toBe(slots.length);
    expect(slots.every((slot) => new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime() === 30 * 60000)).toBe(true);
    expect(slots.some((slot) => slot.label.startsWith(date.endsWith("03-08") ? "2:" : "1:"))).toBe(false);
  });

  it("measures book-ahead days in the clinic calendar across DST", () => {
    const value = config(); value.timezone = "America/New_York"; value.bookingHorizonDays = 1; value.minLeadMinutes = 0;
    const slots = generateSlots(value, "2026-03-08", null, [], new Date("2026-03-07T15:00Z"));
    expect(slots.at(-1)?.startsAt).toBe("2026-03-08T14:00:00.000Z");
  });

  it("rejects a whole local day skipped by a timezone change", () => {
    expect(() => dayBounds("2011-12-30", "Pacific/Apia")).toThrow("does not exist");
  });
});

describe("date override and break validation", () => {
  it.each(["2026-02-30", "2026-02-29", "2026-13-01", "not-a-date"])("rejects invalid calendar date %s", (date) => {
    expect(dateSchema.safeParse(date).success).toBe(false);
  });
  it("accepts a leap date and adjacent special-hours intervals", () => {
    expect(overrideSchema.safeParse({ date: "2028-02-29", mode: "custom", intervals: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "15:00" }] }).success).toBe(true);
  });
  it("requires valid same-day, non-overlapping special hours and no intervals on closed/weekly modes", () => {
    for (const value of [
      { mode: "custom", intervals: [] }, { mode: "closed", intervals: [{ start: "09:00", end: "10:00" }] },
      { mode: "custom", intervals: [{ start: "22:00", end: "02:00" }] },
      { mode: "custom", intervals: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] },
    ]) expect(overrideSchema.safeParse({ date, ...value }).success).toBe(false);
  });
  it("rejects reversed/overnight breaks and excessive notes", () => {
    expect(breakSchema.safeParse({ date, start: "14:00", end: "13:00" }).success).toBe(false);
    expect(breakSchema.safeParse({ date, start: "09:00", end: "10:00", reason: "x".repeat(161) }).success).toBe(false);
  });
});


describe("patient slot grid", () => {
  it("keeps occupied candidates chronological, exposes only generic state and omits breaks", () => {
    const occupied = [occupancy(`${date}T09:20Z`, `${date}T09:40Z`, "appointment"), occupancy(`${date}T10:00Z`, `${date}T10:20Z`)];
    const grid = generateSlotChoices(config(), date, null, occupied, now);
    expect(grid).toHaveLength(8);
    expect(grid.slice(0, 3)).toEqual([
      { startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T09:20:00.000Z`, label: "9:00 AM – 9:20 AM", availability: "available" },
      { startsAt: `${date}T09:20:00.000Z`, endsAt: `${date}T09:40:00.000Z`, label: "9:20 AM – 9:40 AM", availability: "unavailable" },
      { startsAt: `${date}T09:40:00.000Z`, endsAt: `${date}T10:00:00.000Z`, label: "9:40 AM – 10:00 AM", availability: "available" },
    ]);
    expect(grid.filter((slot) => slot.availability === "available").map((slot) => slot.startsAt)).toEqual(generateSlots(config(), date, null, occupied, now).map((slot) => slot.startsAt));
  });
  it("marks saved or candidate buffer conflicts unavailable and gives breaks precedence", () => {
    const value = config(); value.bufferBeforeMinutes = 5; value.bufferAfterMinutes = 5;
    const occupied = [occupancy(`${date}T09:25Z`, `${date}T09:35Z`, "appointment")];
    const grid = generateSlotChoices(value, date, null, occupied, now);
    expect(grid.slice(0, 3).map((slot) => slot.availability)).toEqual(["unavailable", "unavailable", "available"]);
    const withBreak = generateSlotChoices(value, date, null, [...occupied, occupancy(`${date}T09:35Z`, `${date}T09:40Z`)], now);
    expect(withBreak.some((slot) => slot.label.startsWith("9:35"))).toBe(false);
    expect(withBreak[0].availability).toBe("unavailable");
  });
  it("retains closures, special hours, lead time and exact horizon restrictions", () => {
    const value = config(); value.bookingHorizonDays = 1;
    const occupied = [occupancy(`${date}T00:00Z`, "2026-11-11T00:00Z", "appointment")];
    expect(generateSlotChoices(value, date, { mode: "closed", intervals: [], reason: "private" }, occupied, now)).toEqual([]);
    const custom: DateOverride = { mode: "custom", intervals: [{ start: "10:00", end: "11:00" }], reason: "private" };
    const grid = generateSlotChoices(value, date, custom, occupied, new Date(`${date}T09:20Z`));
    expect(grid.map((slot) => slot.label)).toEqual(["10:20 AM – 10:40 AM", "10:40 AM – 11:00 AM"]);
    expect(grid.every((slot) => slot.availability === "unavailable")).toBe(true);
    expect(generateSlotChoices(value, "2026-11-10", null, occupied, now)).toEqual([]);
    expect(generateSlotChoices(value, "2026-11-08", null, occupied, now)).toEqual([]);
  });
  it.each(["2026-03-08", "2026-11-01"])("preserves the DST-safe grid and marks occupancy on %s", (day) => {
    const value = config(); value.timezone = "America/New_York"; value.minLeadMinutes = 0; value.durationMinutes = 30;
    value.weeklyHours[6].intervals = [{ start: "00:00", end: "04:00" }];
    const clock = new Date(`${addDays(day, -1)}T12:00Z`);
    const free = generateSlots(value, day, null, [], clock), chosen = free.at(-1)!;
    const occupied = [occupancy(chosen.occupiedStart, chosen.occupiedEnd, "appointment")];
    const grid = generateSlotChoices(value, day, null, occupied, clock);
    expect(grid.map((slot) => slot.startsAt)).toEqual(free.map((slot) => slot.startsAt));
    expect(grid.at(-1)?.availability).toBe("unavailable");
    expect(grid.filter((slot) => slot.availability === "available").map((slot) => slot.startsAt)).toEqual(generateSlots(value, day, null, occupied, clock).map((slot) => slot.startsAt));
  });
});
