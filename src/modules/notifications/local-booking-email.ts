import "server-only";
import { eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { localBookingEmails } from "@/db/schema/notifications";
import type { BookingEvents } from "@/modules/booking/events";
import type { BookingReceipt } from "@/modules/booking/models";

export function localBookingEmailEnabled(source: Record<string, string | undefined> = process.env) {
  if (!source.LOCAL_BOOKING_EMAIL || source.LOCAL_BOOKING_EMAIL === "false") return false;
  if (source.LOCAL_BOOKING_EMAIL !== "true") throw new Error("Invalid LOCAL_BOOKING_EMAIL configuration.");
  const url = new URL(source.APP_URL ?? "");
  if (!["development", "test"].includes(source.NODE_ENV ?? "") ||
      !["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("LOCAL_BOOKING_EMAIL requires localhost development/test.");
  }
  return true;
}

type EmailDetails = { clinicName: string; doctorName: string; email: string; phone: string };
export function bookingEmailTemplate(receipt: BookingReceipt, clinic: EmailDetails) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: receipt.timezone, dateStyle: "full", timeStyle: "short" }).format(new Date(receipt.startsAt));
  return {
    subject: `Appointment confirmed — ${clinic.clinicName}`,
    body: `Hello,\n\nYour appointment with ${clinic.doctorName} at ${clinic.clinicName} is confirmed.\n\nDate and time: ${time} (${receipt.timezone})\nDuration: ${receipt.durationMinutes} minutes\nBooking reference: ${receipt.id}\n\nFor changes or cancellation, please contact the clinic${clinic.phone ? ` at ${clinic.phone}` : ""}${clinic.email ? ` (${clinic.email})` : ""}.\n\nThank you,\n${clinic.clinicName}`,
  };
}

export function localEmailBookingEvents(enabled: boolean): BookingEvents {
  return { async created(tx, event) {
    if (!enabled || event.actorKind !== "staff") return;
    const message = bookingEmailTemplate(event.receipt, event.clinic);
    // Contacts stay encrypted on the appointment; the preview contains no patient PII.
    await tx.insert(localBookingEmails).values({ appointmentId: event.appointmentId, ...message });
  } };
}

export function createPostBookingLocalEmail(
  getDatabase: () => ApplicationDatabase,
  source: Record<string, string | undefined> = process.env,
  log: (message: string) => void = console.info,
) {
  return async (receipt: BookingReceipt) => {
    if (!localBookingEmailEnabled(source)) return;
    // This is a second transaction, after the appointment commits. Its row lock
    // deduplicates concurrent retries. A failed log leaves the job pending.
    await getDatabase().transaction(async (tx) => {
      const [job] = await tx.select().from(localBookingEmails)
        .where(eq(localBookingEmails.appointmentId, receipt.id)).for("update");
      if (!job || job.loggedAt) return;
      log(JSON.stringify({ event: "booking_email_simulated", delivery: "simulated email sent — no real email sent",
        to: "[patient email redacted]", appointmentId: job.appointmentId, subject: job.subject, body: job.body }));
      await tx.update(localBookingEmails).set({ loggedAt: new Date() }).where(eq(localBookingEmails.appointmentId, receipt.id));
    });
  };
}
