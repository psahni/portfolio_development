import "server-only";
import { and, eq, gt } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import type { ClinicConfiguration } from "@/modules/clinic/configuration";
import { dayOverrides, reservations } from "@/db/schema/scheduling";
import { clinicDate, occupancyFits } from "./engine";
import { conflictTimes, SchedulingError } from "./models";

export async function assertAppointmentsFit(db: Pick<ApplicationDatabase, "select">, config: ClinicConfiguration, now = new Date()) {
  const booked = await db.select().from(reservations).where(and(eq(reservations.doctorId, 1), eq(reservations.kind, "appointment"), gt(reservations.endsAt, now)));
  if (!booked.length) return;
  const overrides = await db.select().from(dayOverrides).where(eq(dayOverrides.doctorId, 1));
  const byDate = new Map(overrides.map((entry) => [entry.date, entry]));
  const conflicts = booked.filter((row) => !occupancyFits(config, byDate.get(clinicDate(row.startsAt, config.timezone)) ?? null, row));
  if (conflicts.length) throw new SchedulingError(409, "This change conflicts with booked appointments. Reschedule or cancel them first.", conflictTimes(conflicts));
}
