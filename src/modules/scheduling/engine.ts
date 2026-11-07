import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import type { ClinicConfiguration } from "@/modules/clinic/configuration";
import { toMinutes, toTime } from "@/modules/clinic/configuration";
import { clockLabel, SchedulingError, type DateOverride, type Occupancy, type TimeInterval } from "./models";

export type Slot = { startsAt: string; endsAt: string; occupiedStart: string; occupiedEnd: string; label: string };

export function zoned(date: Date, timezone: string) {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timezone);
}

export function clinicDate(date: Date, timezone: string) { return zoned(date, timezone).toPlainDate().toString(); }
export function addDays(date: string, days: number) { return Temporal.PlainDate.from(date).add({ days }).toString(); }

export function dayBounds(date: string, timezone: string) {
  const plain = Temporal.PlainDate.from(date);
  const start = plain.toZonedDateTime(timezone);
  if (start.toPlainDate().toString() !== date) throw new SchedulingError(400, "That calendar day does not exist in the clinic timezone.");
  return { start: new Date(start.epochMilliseconds), end: new Date(plain.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds) };
}

export function localInstant(date: string, time: string, timezone: string) {
  try {
    const value = Temporal.PlainDate.from(date).toPlainDateTime(time).toZonedDateTime(timezone, { disambiguation: "reject" });
    return new Date(value.epochMilliseconds);
  } catch { throw new SchedulingError(400, "This time is ambiguous or does not exist because the clinic timezone changes its clock. Choose another time."); }
}

export function instantLabel(value: Date, timezone: string, selectedDate: string) {
  const local = zoned(value, timezone);
  const date = local.toPlainDate().toString();
  return `${date === selectedDate ? "" : `${date} `}${clockLabel(toTime(local.hour * 60 + local.minute))}`;
}

export function effectiveHours(config: ClinicConfiguration, date: string, override: DateOverride | null): TimeInterval[] {
  if (override?.mode === "closed") return [];
  return override?.mode === "custom" ? override.intervals : config.weeklyHours.find((day) => day.day === Temporal.PlainDate.from(date).dayOfWeek - 1)!.intervals;
}

type SlotTimes = {
  visitStart: Date;
  visitEnd: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
};

function getBookingWindow(config: ClinicConfiguration, now: Date) {
  // Calendar days preserve the clinic's local time across daylight-saving changes.
  const latestStartMs = zoned(now, config.timezone).add({ days: config.bookingHorizonDays }).epochMilliseconds;
  return {
    firstDate: clinicDate(now, config.timezone),
    lastDate: clinicDate(new Date(latestStartMs), config.timezone),
    earliestStartMs: now.getTime() + config.minLeadMinutes * 60_000,
    latestStartMs,
  };
}

function getCandidateStartMinutes(hours: TimeInterval[], config: ClinicConfiguration): number[] {
  const { durationMinutes, bufferBeforeMinutes, bufferAfterMinutes } = config;
  const spacingMinutes = bufferBeforeMinutes + durationMinutes + bufferAfterMinutes;
  const sortedHours = [...hours].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const starts: number[] = [];

  for (const interval of sortedHours) {
    const firstStart = toMinutes(interval.start) + bufferBeforeMinutes;
    const lastStart = toMinutes(interval.end) - durationMinutes - bufferAfterMinutes;
    for (let start = firstStart; start <= lastStart; start += spacingMinutes) {
      starts.push(start);
    }
  }
  return starts;
}

function resolveSlotTimes(date: string, startMinute: number, config: ClinicConfiguration): SlotTimes | null {
  const endMinute = startMinute + config.durationMinutes;
  try {
    return {
      occupiedStart: localInstant(date, toTime(startMinute - config.bufferBeforeMinutes), config.timezone),
      occupiedEnd: localInstant(date, toTime(endMinute + config.bufferAfterMinutes), config.timezone),
      visitStart: localInstant(date, toTime(startMinute), config.timezone),
      visitEnd: localInstant(date, toTime(endMinute), config.timezone),
    };
  } catch {
    // Skip ambiguous/nonexistent clock times instead of moving or duplicating a slot.
    return null;
  }
}

function hasExpectedDuration(times: SlotTimes, config: ClinicConfiguration): boolean {
  const visitDurationMs = times.visitEnd.getTime() - times.visitStart.getTime();
  const occupiedDurationMs = times.occupiedEnd.getTime() - times.occupiedStart.getTime();
  const occupiedMinutes = config.bufferBeforeMinutes + config.durationMinutes + config.bufferAfterMinutes;
  // Valid endpoints can still straddle a clock change that alters the elapsed duration.
  return visitDurationMs === config.durationMinutes * 60_000 && occupiedDurationMs === occupiedMinutes * 60_000;
}

function overlapsOccupiedTime(times: SlotTimes, occupied: Occupancy[]): boolean {
  // Touching endpoints are allowed; only intersecting occupied ranges conflict.
  return occupied.some((reservation) => reservation.startsAt < times.occupiedEnd && reservation.endsAt > times.occupiedStart);
}

function formatSlot(times: SlotTimes, startMinute: number, durationMinutes: number): Slot {
  const startLabel = clockLabel(toTime(startMinute));
  const endLabel = clockLabel(toTime(startMinute + durationMinutes));
  return {
    startsAt: times.visitStart.toISOString(),
    endsAt: times.visitEnd.toISOString(),
    occupiedStart: times.occupiedStart.toISOString(),
    occupiedEnd: times.occupiedEnd.toISOString(),
    label: `${startLabel} – ${endLabel}`,
  };
}

export function generateSlots(
  config: ClinicConfiguration,
  date: string,
  override: DateOverride | null,
  occupied: Occupancy[],
  now: Date,
): Slot[] {
  const bookingWindow = getBookingWindow(config, now);
  if (date < bookingWindow.firstDate || date > bookingWindow.lastDate) return [];

  const hours = effectiveHours(config, date, override);
  const slots: Slot[] = [];
  for (const startMinute of getCandidateStartMinutes(hours, config)) {
    const times = resolveSlotTimes(date, startMinute, config);
    if (!times || !hasExpectedDuration(times, config)) continue;

    const visitStartMs = times.visitStart.getTime();
    if (visitStartMs < bookingWindow.earliestStartMs || visitStartMs > bookingWindow.latestStartMs) continue;
    if (overlapsOccupiedTime(times, occupied)) continue;

    slots.push(formatSlot(times, startMinute, config.durationMinutes));
  }
  return slots;
}

/** Compare booked occupancy snapshots, not the current duration/buffer rules. */
export function occupancyFits(config: ClinicConfiguration, override: DateOverride | null, occupancy: Occupancy) {
  const start = zoned(occupancy.startsAt, config.timezone), end = zoned(occupancy.endsAt, config.timezone);
  if (!start.toPlainDate().equals(end.toPlainDate())) return false;
  const startMinute = start.hour * 60 + start.minute + start.second / 60 + start.millisecond / 60000;
  const endMinute = end.hour * 60 + end.minute + end.second / 60 + end.millisecond / 60000;
  if (Math.abs((endMinute - startMinute) * 60_000 - (occupancy.endsAt.getTime() - occupancy.startsAt.getTime())) > 1) return false;
  return effectiveHours(config, start.toPlainDate().toString(), override).some((hours) => toMinutes(hours.start) <= startMinute && endMinute <= toMinutes(hours.end));
}
