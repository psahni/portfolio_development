import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import type { ClinicConfiguration } from "@/modules/clinic/configuration";
import { addDays, clinicDate, dayBounds, effectiveHours, generateSlots, instantLabel } from "./engine";
import { dateSchema, SchedulingError, type DateOverride, type Occupancy } from "./models";
import type { CalendarDay, CalendarEvent, CalendarMode } from "./calendar-model";

export function calendarDates(selected: string, mode: CalendarMode): string[] {
  const date = Temporal.PlainDate.from(selected);
  const first = mode === "week" ? date.subtract({ days: date.dayOfWeek - 1 }) : date;
  const dates = Array.from({ length: mode === "week" ? 7 : 1 }, (_, index) => first.add({ days: index }).toString());
  if (dates.some((value) => !dateSchema.safeParse(value).success || value < "0001-01-01")) {
    throw new SchedulingError(400, "Choose a date whose calendar view fits between years 1 and 9999.");
  }
  return dates;
}

type CalendarReservation = Occupancy & { id: string };

export function buildCalendarDay(
  config: ClinicConfiguration, date: string, override: DateOverride | null,
  reservations: CalendarReservation[], now: Date,
): CalendarDay {
  const bounds = dayBounds(date, config.timezone);
  const occupied = reservations.filter((row) => row.startsAt < bounds.end && row.endsAt > bounds.start);
  const available: CalendarEvent[] = generateSlots(config, date, override, occupied, now).map((slot) => ({
    id: `available:${slot.startsAt}`, kind: "available", startsAt: slot.startsAt, endsAt: slot.endsAt,
    label: slot.label, note: "", continuesFromPreviousDay: false, continuesToNextDay: false,
  }));
  const booked: CalendarEvent[] = occupied.map((row) => ({
    id: row.id, kind: row.kind, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    label: `${instantLabel(row.startsAt, config.timezone, date)} – ${instantLabel(row.endsAt, config.timezone, date)}`,
    note: row.kind === "block" ? row.reason ?? "" : "",
    continuesFromPreviousDay: row.startsAt < bounds.start,
    continuesToNextDay: row.endsAt > bounds.end,
  }));
  return {
    date, hours: effectiveHours(config, date, override),
    events: [...available, ...booked].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    outsideWindow: date < clinicDate(now, config.timezone) || date > addDays(clinicDate(now, config.timezone), config.bookingHorizonDays),
  };
}
