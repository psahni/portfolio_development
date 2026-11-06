import "server-only";
import { asc, eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { clinicSettings, doctorProfile, weeklyHours } from "@/db/schema/clinic";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { configurationSchema, emptyConfiguration, toMinutes, toTime } from "./configuration";

type AdminAccess = { requireAdminAccess(headers: Headers): Promise<ClinicPrincipal> };

export function createClinicService(db: ApplicationDatabase, access: AdminAccess) {
  async function get(headers: Headers) {
    await access.requireAdminAccess(headers);
    // One statement reads a consistent configuration, including concurrent whole-schedule saves.
    const rows = await db.select({ clinic: clinicSettings, doctor: doctorProfile, hours: weeklyHours })
      .from(clinicSettings).innerJoin(doctorProfile, eq(doctorProfile.id, clinicSettings.id))
      .leftJoin(weeklyHours, eq(weeklyHours.doctorId, doctorProfile.id))
      .where(eq(clinicSettings.id, 1)).orderBy(asc(weeklyHours.day), asc(weeklyHours.startMinute));
    if (!rows.length) return null;
    const { clinic, doctor } = rows[0];
    const result = {
      ...emptyConfiguration(), clinicName: clinic.name, doctorName: doctor.name,
      email: clinic.email, phone: clinic.phone, timezone: clinic.timezone,
      durationMinutes: doctor.durationMinutes, bufferBeforeMinutes: doctor.bufferBeforeMinutes,
      bufferAfterMinutes: doctor.bufferAfterMinutes, minLeadMinutes: doctor.minLeadMinutes, bookingHorizonDays: doctor.bookingHorizonDays,
    };
    for (const { hours } of rows) {
      if (hours) result.weeklyHours[hours.day].intervals.push({ start: toTime(hours.startMinute), end: toTime(hours.endMinute) });
    }
    return result;
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
