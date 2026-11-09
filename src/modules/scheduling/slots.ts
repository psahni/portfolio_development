import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import { addDays, clinicDate, dayBounds, generateSlots } from "./engine";
import { dateSchema, SchedulingError } from "./models";

export type AvailableTimes = {
  configured: boolean; clinicName: string; doctorName: string; timezone: string;
  date: string; today: string; lastDate: string;
  slots: { startsAt: string; endsAt: string; label: string }[];
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
        timezone, date, today, lastDate, slots: [] };
      if (!config) return result;
      if (date < today || date > lastDate) throw new SchedulingError(400, "Choose a date within the booking window.");
      const bounds = dayBounds(date, timezone);
      const [override] = await tx.select().from(dayOverrides).where(and(eq(dayOverrides.doctorId, 1), eq(dayOverrides.date, date)));
      const occupied = await tx.select().from(reservations).where(and(eq(reservations.doctorId, 1), lt(reservations.startsAt, bounds.end), gt(reservations.endsAt, bounds.start)));
      result.slots = generateSlots(config, date, override ?? null, occupied, now)
        .map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label }));
      return result;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  return { read };
}
