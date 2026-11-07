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

export function generateSlots(config: ClinicConfiguration, date: string, override: DateOverride | null, occupied: Occupancy[], now: Date): Slot[] {
  const earliest = now.getTime() + config.minLeadMinutes * 60_000;
  const latest = zoned(now, config.timezone).add({ days: config.bookingHorizonDays }).epochMilliseconds;
  if (date < clinicDate(now, config.timezone) || date > clinicDate(new Date(latest), config.timezone)) return [];
  const slots: Slot[] = [];
  const stride = config.bufferBeforeMinutes + config.durationMinutes + config.bufferAfterMinutes;
  const windows = [...effectiveHours(config, date, override)].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (const window of windows) {
    for (let start = toMinutes(window.start) + config.bufferBeforeMinutes; start + config.durationMinutes + config.bufferAfterMinutes <= toMinutes(window.end); start += stride) {
      const end = start + config.durationMinutes;
      let occupiedStart: Date, occupiedEnd: Date, visitStart: Date, visitEnd: Date;
      try {
        occupiedStart = localInstant(date, toTime(start - config.bufferBeforeMinutes), config.timezone);
        occupiedEnd = localInstant(date, toTime(end + config.bufferAfterMinutes), config.timezone);
        visitStart = localInstant(date, toTime(start), config.timezone);
        visitEnd = localInstant(date, toTime(end), config.timezone);
      } catch { continue; } // Never silently shift or duplicate a DST-gap/fold appointment.
      if (visitEnd.getTime() - visitStart.getTime() !== config.durationMinutes * 60_000 || occupiedEnd.getTime() - occupiedStart.getTime() !== stride * 60_000) continue;
      if (visitStart.getTime() < earliest || visitStart.getTime() > latest) continue;
      if (occupied.some((row) => row.startsAt < occupiedEnd && row.endsAt > occupiedStart)) continue;
      slots.push({ startsAt: visitStart.toISOString(), endsAt: visitEnd.toISOString(), occupiedStart: occupiedStart.toISOString(), occupiedEnd: occupiedEnd.toISOString(), label: `${clockLabel(toTime(start))} – ${clockLabel(toTime(end))}` });
    }
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
