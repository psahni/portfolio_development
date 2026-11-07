import "server-only";
import { eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { clinicSettings, doctorProfile, weeklyHours } from "@/db/schema/clinic";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { configurationSchema, toMinutes } from "./configuration";
import { readClinicConfiguration } from "./repository";
import { assertAppointmentsFit } from "@/modules/scheduling/constraints";

type AdminAccess = { requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> };

export function createClinicService(db: ApplicationDatabase, access: AdminAccess, clock = () => new Date()) {
  async function get(headers: Headers) {
    await access.requireAdminAccess(headers);
    return readClinicConfiguration(db);
  }

  async function save(headers: Headers, input: unknown) {
    await access.requireAdminAccess(headers);
    const value = configurationSchema.parse(input);
    await db.transaction(async (tx) => {
      const clinic = { name: value.clinicName, email: value.email, phone: value.phone, timezone: value.timezone, updatedAt: new Date() };
      await tx.insert(clinicSettings).values({ id: 1, ...clinic }).onConflictDoUpdate({ target: clinicSettings.id, set: clinic });
      const doctor = {
        name: value.doctorName, durationMinutes: value.durationMinutes, bufferBeforeMinutes: value.bufferBeforeMinutes,
        bufferAfterMinutes: value.bufferAfterMinutes, minLeadMinutes: value.minLeadMinutes, bookingHorizonDays: value.bookingHorizonDays,
      };
      // Upserting the singleton doctor row locks it until commit; schedule replacements cannot interleave.
      await tx.insert(doctorProfile).values({ id: 1, ...doctor }).onConflictDoUpdate({ target: doctorProfile.id, set: doctor });
      await assertAppointmentsFit(tx, value, clock());
      await tx.delete(weeklyHours).where(eq(weeklyHours.doctorId, 1));
      const intervals = value.weeklyHours.flatMap((day) => day.intervals.map((interval) => ({
        doctorId: 1, day: day.day, startMinute: toMinutes(interval.start), endMinute: toMinutes(interval.end),
      })));
      if (intervals.length) await tx.insert(weeklyHours).values(intervals);
    });
    return value;
  }

  return { get, save };
}
