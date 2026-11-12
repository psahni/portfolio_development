import "server-only";
import type { ApplicationDatabase } from "@/db/connection";
import type { BookingReceipt } from "@/modules/booking/models";
import { createWhatsAppDelivery } from "./delivery";
import { logWhatsAppFailure, type WhatsAppFailureLogger } from "./logging";
import { createMetaWhatsApp, readWhatsAppConfig, isWhatsAppWorkerEnabled, type MetaConfig, type WhatsAppSender } from "./meta";

export const REQUEST_SEND_TIMEOUT_MS = 3_000;
export function createPostBookingWhatsApp(
  getDatabase: () => ApplicationDatabase,
  source: Record<string, string | undefined> = process.env,
  getSender: (config: MetaConfig) => WhatsAppSender = (config) => createMetaWhatsApp(config, fetch, REQUEST_SEND_TIMEOUT_MS),
  report: WhatsAppFailureLogger = logWhatsAppFailure,
  clock = () => new Date(),
) {
  return async (receipt: BookingReceipt): Promise<void> => {
    try {
      if (isWhatsAppWorkerEnabled(source)) return;
      const config = readWhatsAppConfig(source);
      if (!config) return;
      // Process only this committed appointment, never drain other patients' jobs.
      await createWhatsAppDelivery(getDatabase(), getSender(config), clock, report).sendForAppointment(receipt.id);
    } catch {
      // Includes misconfiguration and result-persistence failures after COMMIT.
      // A possibly accepted send is not retried automatically; its saved claim
      // becomes uncertain on recovery. Do not expose the original error.
      report({ appointmentId: receipt.id, status: "uncertain", code: "REQUEST_DELIVERY_FAILED" });
    }
  };
}
