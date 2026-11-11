import { z } from "zod";
import { dateSchema } from "@/modules/scheduling/models";
import type { PatientContact } from "./models";

const note = (max: number) => z.string().trim().max(max).refine((value) =>
  !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), "Use a short note without control characters.");

export const doctorDateSchema = dateSchema.refine((value) => value >= "0001-01-01" && value <= "9999-12-31", "Choose a date between years 1 and 9999.").optional();
export const doctorCancellationSchema = z.object({
  appointmentId: z.uuid(),
  reason: note(160).pipe(z.string().min(1, "Enter a short nonclinical reason.")),
  rebookingInstruction: note(300).default(""),
  blockOriginalTime: z.boolean().default(false),
}).strict();

export type DoctorAppointment = {
  id: string; startsAt: string; endsAt: string; bookedTimezone: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  contact: PatientContact; canCancel: boolean;
  cancellation: { reason: string; rebookingInstruction: string; originalTimeBlocked: boolean; cancelledAt: string } | null;
};
export type DoctorAppointmentsView = {
  configured: boolean; date: string; timezone: string; appointments: DoctorAppointment[];
};
