import "server-only";
import { asc, eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { clinicSettings, doctorProfile, weeklyHours } from "@/db/schema/clinic";
import { emptyConfiguration, toTime } from "./configuration";

export async function readClinicConfiguration(db: Pick<ApplicationDatabase, "select">) {
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
  for (const { hours } of rows) if (hours) result.weeklyHours[hours.day].intervals.push({ start: toTime(hours.startMinute), end: toTime(hours.endMinute) });
  return result;
}
