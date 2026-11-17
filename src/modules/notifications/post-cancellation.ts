import "server-only";
import { eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { appointments } from "@/db/schema/booking";
import { createContactProtection } from "@/modules/booking/contact-protection";
import type { CancellationReceipt } from "@/modules/booking/models";
import { createWhatsAppDelivery } from "./delivery";
import { logWhatsAppFailure, type WhatsAppFailureLogger } from "./logging";
import { createMetaCancellationSender, readConversationMetaConfig } from "./meta-conversation";
import { isWhatsAppWorkerEnabled } from "./meta";

export function createPostCancellationWhatsApp(
  getDatabase: () => ApplicationDatabase,
  source: Record<string, string | undefined> = process.env,
  report: WhatsAppFailureLogger = logWhatsAppFailure,
  clock = () => new Date(),
) {
  return async (receipt: CancellationReceipt): Promise<void> => {
    try {
      if (isWhatsAppWorkerEnabled(source)) return;
      const config = readConversationMetaConfig(source);
      if (!config) return;
      const db = getDatabase(), protection = createContactProtection(source.BOOKING_DATA_KEY);
      const resolveRecipient = async (appointmentId: string) => {
        const [appointment] = await db.select({ contactCiphertext: appointments.contactCiphertext }).from(appointments).where(eq(appointments.id, appointmentId));
        return appointment ? protection.decrypt(appointmentId, appointment.contactCiphertext).phone : null;
      };
      await createWhatsAppDelivery(db, createMetaCancellationSender(config, fetch, 3_000), clock, report, resolveRecipient)
        .sendForAppointmentEvent(receipt.id, "appointment_cancelled");
    } catch {
      report({ appointmentId: receipt.id, status: "uncertain", code: "CANCELLATION_DELIVERY_FAILED" });
    }
  };
}
