import { z } from "zod";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time between 00:00 and 23:59.");
const name = z.string().trim().min(1, "Enter the clinic and doctor names.").max(120, "Names must be 120 characters or fewer.");
const bounded = (label: string, min: number, max: number) => z.number({ error: `Enter ${label.toLowerCase()} as a number.` }).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);

export function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function toTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function validTimezone(value: string) {
  if (value !== "UTC" && !value.includes("/")) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

export const configurationSchema = z.object({
  clinicName: name,
  doctorName: name,
  email: z.string().trim().max(254, "Contact email must be 254 characters or fewer.").pipe(z.union([z.literal(""), z.email("Enter a valid contact email.")])).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(32).refine((value) => value === "" || (/^[+()0-9 .-]+$/.test(value) && value.replace(/\D/g, "").length >= 5), "Enter a valid contact phone number."),
  timezone: z.string().refine(validTimezone, "Choose a valid clinic timezone."),
  durationMinutes: bounded("Appointment duration", 5, 240),
  bufferBeforeMinutes: bounded("Buffer before", 0, 120),
  bufferAfterMinutes: bounded("Buffer after", 0, 120),
  minLeadMinutes: bounded("Minimum notice", 0, 10080),
  bookingHorizonDays: bounded("Booking horizon", 1, 365),
  weeklyHours: z.array(z.object({
    day: z.number().int().min(0).max(6),
    intervals: z.array(z.object({ start: time, end: time })).max(8, "Use up to eight intervals per day."),
  })).length(7, "Provide all seven days of the week."),
}).superRefine((value, ctx) => {
  if (new Set(value.weeklyHours.map((day) => day.day)).size !== 7) {
    ctx.addIssue({ code: "custom", path: ["weeklyHours"], message: "Each weekday must appear exactly once." });
  }
  value.weeklyHours.forEach((day, index) => {
    const sorted = [...day.intervals].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 0; i < sorted.length; i++) {
      if (toMinutes(sorted[i].start) >= toMinutes(sorted[i].end)) {
        ctx.addIssue({ code: "custom", path: ["weeklyHours", index, "intervals"], message: `${DAYS[day.day]} closing time must be after opening time; use same-day hours.` });
      }
      if (i > 0 && toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        ctx.addIssue({ code: "custom", path: ["weeklyHours", index, "intervals"], message: `${DAYS[day.day]} hours must not overlap.` });
      }
    }
  });
});

export type ClinicConfiguration = z.infer<typeof configurationSchema>;

export function emptyConfiguration(): ClinicConfiguration {
  return {
    clinicName: "", doctorName: "", email: "", phone: "", timezone: "",
    durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minLeadMinutes: 60, bookingHorizonDays: 30,
    weeklyHours: DAYS.map((_, day) => ({ day, intervals: [] })),
  };
}

export function timezoneOptions(selected = "") {
  return [...new Set(["UTC", "Asia/Kolkata", ...Intl.supportedValuesOf("timeZone"), ...(selected ? [selected] : [])])].sort();
}
