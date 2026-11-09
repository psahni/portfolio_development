import { describe, expect, it } from "vitest";
import type { CalendarDay, CalendarEvent } from "@/modules/scheduling/calendar-model";
import { availablePositions, calendarDayBounds, calendarScale, eventPosition, gridTimeLabel, openingPositions } from "@/app/admin/calendar/calendar-layout";

function event(start: string, end: string): CalendarEvent {
  return { id: start, kind: "available", startsAt: start, endsAt: end, label: "", note: "", continuesFromPreviousDay: false, continuesToNextDay: false };
}
function day(date = "2026-11-09"): CalendarDay {
  return { date, hours: [{ start: "09:00", end: "12:00" }], events: [], outsideWindow: false };
}

describe("calendar presentation geometry", () => {
  it("positions the same instants in the clinic timezone, preserving duration and buffer gaps", () => {
    const first = event("2026-11-09T03:35Z", "2026-11-09T03:55Z");
    const next = event("2026-11-09T04:05Z", "2026-11-09T04:25Z");
    expect(eventPosition(first, "2026-11-09", "Asia/Kolkata")).toEqual({ start: 545, end: 565 });
    expect(eventPosition(next, "2026-11-09", "Asia/Kolkata")).toEqual({ start: 575, end: 595 });
  });
  it("consolidates touching availability without filling a buffer gap", () => {
    const value = day();
    value.events = [event("2026-11-09T09:00Z", "2026-11-09T09:20Z"), event("2026-11-09T09:20Z", "2026-11-09T09:40Z"), event("2026-11-09T09:50Z", "2026-11-09T10:10Z")];
    expect(availablePositions(value, "UTC")).toEqual([{ start: 540, end: 580 }, { start: 590, end: 610 }]);
  });
  it("clips cross-midnight occupancy to the displayed day and excludes touching endpoints", () => {
    expect(eventPosition(event("2026-11-08T23:40Z", "2026-11-09T00:20Z"), "2026-11-09", "UTC")).toEqual({ start: 0, end: 20 });
    expect(eventPosition(event("2026-11-09T23:40Z", "2026-11-10T00:20Z"), "2026-11-09", "UTC")).toEqual({ start: 1420, end: 1440 });
    expect(eventPosition(event("2026-11-08T23:40Z", "2026-11-09T00:00Z"), "2026-11-09", "UTC")).toBeNull();
    expect(eventPosition(event("2026-11-10T00:00Z", "2026-11-10T00:20Z"), "2026-11-09", "UTC")).toBeNull();
  });
  it("distinguishes the two repeated DST hours instead of overlapping their events", () => {
    const first = event("2026-11-01T05:30Z", "2026-11-01T05:50Z");
    const second = event("2026-11-01T06:30Z", "2026-11-01T06:50Z");
    expect(eventPosition(first, "2026-11-01", "America/New_York")).toEqual({ start: 90, end: 110 });
    expect(eventPosition(second, "2026-11-01", "America/New_York")).toEqual({ start: 150, end: 170 });
    expect(gridTimeLabel("2026-11-01", "America/New_York", 90, true)).toContain("GMT-4");
    expect(gridTimeLabel("2026-11-01", "America/New_York", 150, true)).toContain("GMT-5");
  });
  it("preserves actual duration across the spring clock jump", () => {
    expect(eventPosition(event("2026-03-08T06:45Z", "2026-03-08T07:15Z"), "2026-03-08", "America/New_York")).toEqual({ start: 105, end: 135 });
    expect(gridTimeLabel("2026-03-08", "America/New_York", 120)).toBe("3 AM");
  });
  it("sizes 23-hour and 25-hour days and marks mixed weeks for individual time labels", () => {
    expect(calendarDayBounds("2026-03-08", "America/New_York").minutes).toBe(1380);
    expect(calendarDayBounds("2026-11-01", "America/New_York").minutes).toBe(1500);
    expect(calendarScale([day("2026-10-31"), day("2026-11-01")], "America/New_York").hasClockChange).toBe(true);
  });
  it("shows the full opening window through a repeated hour", () => {
    expect(openingPositions({ ...day("2026-11-01"), hours: [{ start: "00:00", end: "04:00" }] }, "America/New_York")).toEqual([{ start: 0, end: 300 }]);
  });
  it("frames opening hours with context and gives closed days an empty time grid", () => {
    expect(calendarScale([day()], "UTC")).toMatchObject({ start: 480, end: 780, height: 480, hasClockChange: false });
    const closed = { ...day(), hours: [] };
    expect(openingPositions(closed, "UTC")).toEqual([]);
    expect(calendarScale([closed], "UTC")).toMatchObject({ start: 480, end: 1080 });
  });
});
