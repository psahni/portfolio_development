import "server-only";
import { and, eq, gt, gte, lt, lte } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import { addDays, clinicDate, dayBounds, effectiveHours, generateSlotChoices, type SlotChoice } from "./engine";
import { dateSchema, SchedulingError } from "./models";

export type AvailableTimes = {
  configured: boolean; clinicName: string; doctorName: string; timezone: string;
  date: string; today: string; lastDate: string; closed: boolean; noAvailableDates: boolean;
  slots: SlotChoice[];
};

// Shared read model for booking forms. Occupancy and internal notes never leave it.
export function createSlotAvailabilityService(db: ApplicationDatabase, clock = () => new Date()) {
  async function read(selected?: string): Promise<AvailableTimes> {
    const requestedDate = selected === undefined ? undefined : dateSchema.parse(selected);
    return db.transaction(async (tx) => {
      const now = clock(), config = await readClinicConfiguration(tx);
      const timezone = config?.timezone ?? "UTC", today = clinicDate(now, timezone);
      const date = requestedDate ?? today, lastDate = addDays(today, config?.bookingHorizonDays ?? 0);
      const result: AvailableTimes = { configured: !!config, clinicName: config?.clinicName ?? "", doctorName: config?.doctorName ?? "",
        timezone, date, today, lastDate, closed: false, noAvailableDates: false, slots: [] };
      if (!config) return result;
      if (date < today || date > lastDate) throw new SchedulingError(400, "Choose a date within the booking window.");
      const through = requestedDate ?? lastDate;
      const days: { date: string; start: Date; end: Date }[] = [];
      for (let candidate = date; candidate <= through; candidate = addDays(candidate, 1)) {
        try { days.push({ date: candidate, ...dayBounds(candidate, timezone) }); }
        catch (error) {
          // A timezone can skip a whole local date. Do not select that date
          // automatically; an explicit request still gets its validation error.
          if (requestedDate || !(error instanceof SchedulingError)) throw error;
        }
      }
      const first = days[0], last = days.at(-1)!;
      if (!first) return { ...result, noAvailableDates: true };
      // Read the bounded window in bulk, rather than querying once per closed day.
      const overrides = await tx.select().from(dayOverrides).where(and(eq(dayOverrides.doctorId, 1), gte(dayOverrides.date, first.date), lte(dayOverrides.date, last.date)));
      const occupied = await tx.select().from(reservations).where(and(eq(reservations.doctorId, 1), lt(reservations.startsAt, last.end), gt(reservations.endsAt, first.start)));
      const byDate = new Map(overrides.map((override) => [override.date, override]));
      let empty = result;
      for (const day of days) {
        const override = byDate.get(day.date) ?? null;
        const dayOccupancy = occupied.filter((row) => row.startsAt < day.end && row.endsAt > day.start);
        const view: AvailableTimes = { ...result, date: day.date, closed: effectiveHours(config, day.date, override).length === 0,
          slots: generateSlotChoices(config, day.date, override, dayOccupancy, now) };
        if (day === first) empty = view;
        if (requestedDate || view.slots.some((slot) => slot.availability === "available")) return view;
      }
      return { ...empty, slots: [], noAvailableDates: true };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  return { read };
}
