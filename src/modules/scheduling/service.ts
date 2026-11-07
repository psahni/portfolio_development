import "server-only";
import { and, asc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { doctorProfile } from "@/db/schema/clinic";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import type { ClinicConfiguration } from "@/modules/clinic/configuration";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { addDays, clinicDate, dayBounds, effectiveHours, generateSlots, instantLabel, localInstant, type Slot } from "./engine";
import { assertAppointmentsFit } from "./constraints";
import { breakSchema, conflictTimes, dateSchema, overrideSchema, removeBreakSchema, SchedulingError, type DateOverride, type TimeInterval } from "./models";

type Transaction = Parameters<Parameters<ApplicationDatabase["transaction"]>[0]>[0];
type AdminAccess = { requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> };
export type AvailabilityView = {
  configured: boolean; date: string; today: string; maxOverrideDate: string; timezone: string;
  weeklyHours: TimeInterval[]; effectiveHours: TimeInterval[]; override: DateOverride | null;
  blocks: { id: string; startsAt: string; endsAt: string; label: string; reason: string }[];
  slots: Slot[]; outsideWindow: boolean;
};

function isOverlapError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "23P01") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

function reservationMatchesDate(date: string, timezone: string) {
  const { start: midnight } = dayBounds(date, timezone);
  // Compare the clinic-local date, not the UTC date or the database session's date.
  const startsOnDate = eq(sql<string>`(${reservations.startsAt} AT TIME ZONE ${timezone})::date`, date);
  // A reservation from an earlier date may still occupy the selected day.
  const continuesIntoDate = and(lt(reservations.startsAt, midnight), gt(reservations.endsAt, midnight));
  return or(startsOnDate, continuesIntoDate);
}

export function createSchedulingService(db: ApplicationDatabase, access: AdminAccess, clock = () => new Date()) {
  async function preview(headers: Headers, selected?: string): Promise<AvailabilityView> {
    await access.requireAdminAccess(headers);
    return db.transaction(async (tx) => {
      const now = clock(), config = await readClinicConfiguration(tx);
      const timezone = config?.timezone ?? "UTC", today = clinicDate(now, timezone);
      const date = dateSchema.parse(selected ?? today);
      const empty: AvailabilityView = { configured: false, date, today, maxOverrideDate: addDays(today, 365), timezone, weeklyHours: [], effectiveHours: [], override: null, blocks: [], slots: [], outsideWindow: false };
      if (!config) return empty;
      const [override] = await tx.select().from(dayOverrides).where(and(eq(dayOverrides.doctorId, 1), eq(dayOverrides.date, date)));
      const occupied = await tx.select().from(reservations)
        .where(and(eq(reservations.doctorId, 1), reservationMatchesDate(date, timezone)))
        .orderBy(asc(reservations.startsAt));
      return {
        ...empty, configured: true, override: override ?? null,
        weeklyHours: effectiveHours(config, date, null), effectiveHours: effectiveHours(config, date, override ?? null),
        blocks: occupied.filter((row) => row.kind === "block").map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), reason: row.reason, label: `${instantLabel(row.startsAt, timezone, date)} – ${instantLabel(row.endsAt, timezone, date)}` })),
        slots: generateSlots(config, date, override ?? null, occupied, now),
        outsideWindow: date < today || date > addDays(today, config.bookingHorizonDays),
      };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function write(date: string, work: (tx: Transaction, config: ClinicConfiguration, now: Date) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        // All schedule writes and the upcoming booking service share this doctor-row lock.
        const [doctor] = await tx.select({ id: doctorProfile.id }).from(doctorProfile).where(eq(doctorProfile.id, 1)).for("update");
        if (!doctor) throw new SchedulingError(409, "Save clinic settings before changing availability.");
        const config = (await readClinicConfiguration(tx))!, now = clock(), today = clinicDate(now, config.timezone);
        if (date < today || date > addDays(today, 365)) throw new SchedulingError(400, "Choose today or a date within the next 365 days.");
        dayBounds(date, config.timezone);
        await work(tx, config, now);
      });
    } catch (error) {
      if (isOverlapError(error)) throw new SchedulingError(409, "This time is already blocked or booked. Reload the day and choose another time.");
      throw error;
    }
  }

  async function saveOverride(headers: Headers, input: unknown) {
    await access.requireAdminAccess(headers);
    const value = overrideSchema.parse(input);
    await write(value.date, async (tx, config, now) => {
      for (const interval of value.intervals) {
        localInstant(value.date, interval.start, config.timezone); localInstant(value.date, interval.end, config.timezone);
      }
      if (value.mode === "weekly") await tx.delete(dayOverrides).where(and(eq(dayOverrides.doctorId, 1), eq(dayOverrides.date, value.date)));
      else {
        const data = { mode: value.mode, intervals: value.intervals, reason: value.reason };
        await tx.insert(dayOverrides).values({ doctorId: 1, date: value.date, ...data }).onConflictDoUpdate({ target: [dayOverrides.doctorId, dayOverrides.date], set: data });
      }
      await assertAppointmentsFit(tx, config, now);
    });
  }

  async function addBreak(headers: Headers, input: unknown) {
    await access.requireAdminAccess(headers);
    const value = breakSchema.parse(input);
    await write(value.date, async (tx, config, now) => {
      const startsAt = localInstant(value.date, value.start, config.timezone), endsAt = localInstant(value.date, value.end, config.timezone);
      if (endsAt <= now) throw new SchedulingError(400, "Choose a break that ends in the future.");
      const conflicts = await tx.select().from(reservations).where(and(eq(reservations.doctorId, 1), lt(reservations.startsAt, endsAt), gt(reservations.endsAt, startsAt)));
      if (conflicts.length) throw new SchedulingError(409, "This break overlaps an existing break or booked appointment.", conflictTimes(conflicts));
      await tx.insert(reservations).values({ doctorId: 1, kind: "block", startsAt, endsAt, reason: value.reason });
    });
  }

  async function removeBreak(headers: Headers, input: unknown) {
    await access.requireAdminAccess(headers);
    const value = removeBreakSchema.parse(input);
    await write(value.date, async (tx, config) => {
      const removed = await tx.delete(reservations).where(and(
        eq(reservations.id, value.id), eq(reservations.doctorId, 1), eq(reservations.kind, "block"),
        reservationMatchesDate(value.date, config.timezone),
      )).returning({ id: reservations.id });
      if (!removed.length) throw new SchedulingError(404, "That break no longer exists. Reload the day.");
    });
  }

  return { preview, saveOverride, addBreak, removeBreak };
}
