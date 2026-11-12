import { z } from "zod";

const name = z.string().trim().min(1).max(100).refine((value) =>
  !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), "Use a name without control characters.");
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const phone = z.string().trim().max(40).regex(/^\+?[\d ()-]+$/)
  .transform((value) => value.replace(/[ ()-]/g, ""))
  .refine((value) => /^\+?\d{7,15}$/.test(value), "Use a phone number with 7–15 digits.");

export const contactSchema = z.object({ name, email, phone }).strict();
const bookingFields = {
  requestId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }).refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }, "Choose a supported appointment date.").transform((value) => new Date(value).toISOString()),
  name, phone,
};
export const patientBookingSchema = z.object({ ...bookingFields, whatsappConsent: z.boolean().default(false) }).strict();
export const patientCancellationSchema = z.object({ appointmentId: z.uuid() }).strict();
export type CancellationReceipt = { id: string; status: "cancelled" };
export const clinicBookingSchema = z.object({ ...bookingFields, email }).strict();
export type PatientContact = z.infer<typeof contactSchema>;
export type BookingActor = { kind: "patient" | "staff"; userId: string; sessionId: string };
export type BookingReceipt = {
  id: string; status: "confirmed"; startsAt: string; endsAt: string; timezone: string;
  durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number;
};

export class BookingError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
