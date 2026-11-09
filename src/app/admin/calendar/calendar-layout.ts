import { Temporal } from "@js-temporal/polyfill";
import type { CalendarDay, CalendarEvent } from "@/modules/scheduling/calendar-model";

export const HOUR_HEIGHT = 96;
const MINUTE_MS = 60_000;

export function calendarDayBounds(date: string, timezone: string) {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime(timezone).epochMilliseconds;
  const end = day.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds;
  return { start, end, minutes: (end - start) / MINUTE_MS };
}

/** Elapsed minutes preserve exact durations, including repeated/skipped DST hours. */
export function eventPosition(event: CalendarEvent, date: string, timezone: string) {
  const day = calendarDayBounds(date, timezone);
  const start = Math.max(Date.parse(event.startsAt), day.start);
  const end = Math.min(Date.parse(event.endsAt), day.end);
  return end > start ? { start: (start - day.start) / MINUTE_MS, end: (end - day.start) / MINUTE_MS } : null;
}

export function openingPositions(day: CalendarDay, timezone: string) {
  const bounds = calendarDayBounds(day.date, timezone);
  const date = Temporal.PlainDate.from(day.date);
  return day.hours.map((hours) => {
    // Background windows cover both occurrences of a repeated clock time. Bookable
    // slots still come exclusively from the server's stricter scheduling rules.
    const start = date.toPlainDateTime(hours.start).toZonedDateTime(timezone, { disambiguation: "earlier" }).epochMilliseconds;
    const end = date.toPlainDateTime(hours.end).toZonedDateTime(timezone, { disambiguation: "later" }).epochMilliseconds;
    return { start: (start - bounds.start) / MINUTE_MS, end: (end - bounds.start) / MINUTE_MS };
  });
}

/** Join only touching available visits; preparation buffers stay visibly unavailable. */
export function availablePositions(day: CalendarDay, timezone: string) {
  const visits = day.events.filter((event) => event.kind === "available")
    .map((event) => eventPosition(event, day.date, timezone)).filter((value) => value !== null)
    .sort((a, b) => a.start - b.start);
  const windows: { start: number; end: number }[] = [];
  for (const visit of visits) {
    const last = windows.at(-1);
    if (last?.end === visit.start) last.end = visit.end;
    else windows.push({ ...visit });
  }
  return windows;
}

export function calendarScale(days: CalendarDay[], timezone: string) {
  const positions = days.flatMap((day) => [
    ...openingPositions(day, timezone),
    ...day.events.map((event) => eventPosition(event, day.date, timezone)).filter((value) => value !== null),
  ]);
  const longestDay = Math.max(1440, ...days.map((day) => calendarDayBounds(day.date, timezone).minutes));
  const start = positions.length ? Math.max(0, Math.floor(Math.min(...positions.map((p) => p.start)) / 60) * 60 - 60) : 480;
  const end = positions.length ? Math.min(longestDay, Math.ceil(Math.max(...positions.map((p) => p.end)) / 60) * 60 + 60) : 1080;
  return {
    start, end, height: (end - start) * HOUR_HEIGHT / 60,
    ticks: Array.from({ length: Math.ceil((end - start) / 60) + 1 }, (_, index) => start + index * 60),
    hasClockChange: days.some((day) => calendarDayBounds(day.date, timezone).minutes !== 1440),
  };
}

export function gridTimeLabel(date: string, timezone: string, minute: number, showOffset = false) {
  const instant = calendarDayBounds(date, timezone).start + minute * MINUTE_MS;
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", ...(showOffset ? { timeZoneName: "shortOffset" } : {}) }).format(new Date(instant)).replace(":00", "");
}

export function clockOffset(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}
