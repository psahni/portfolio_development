import { config } from "dotenv";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "../src/db/connection";
import { readAuthEnvironment } from "../src/platform/env";
import { createMetaWhatsApp, readWhatsAppConfig, isWhatsAppWorkerEnabled, type WhatsAppSender } from "../src/modules/notifications/meta";
import { createMetaCancellationSender, readConversationMetaConfig } from "../src/modules/notifications/meta-conversation";
import { createWhatsAppDelivery } from "../src/modules/notifications/delivery";
import { createContactProtection } from "../src/modules/booking/contact-protection";
import { appointments } from "../src/db/schema/booking";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
async function main() {
  if (!isWhatsAppWorkerEnabled()) { process.stdout.write("WhatsApp request delivery is selected. Worker will not send.\n"); return; }
  const settings = readWhatsAppConfig();
  const conversationSettings = readConversationMetaConfig();
  if (!settings && !conversationSettings) { process.stdout.write("WhatsApp is disabled. No messages sent.\n"); return; }
  const { db, pool } = createDatabase(readAuthEnvironment().DATABASE_URL);
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  const fixedSender = settings ? createMetaWhatsApp(settings) : null;
  const cancellationSender = conversationSettings ? createMetaCancellationSender(conversationSettings) : null;
  const sender: WhatsAppSender = { async send(visit, destination) {
    if (destination?.event === "appointment_cancelled") return cancellationSender?.send(visit, destination) ?? { status: "failed", errorCode: "CANCELLATION_SENDER_UNAVAILABLE" };
    return fixedSender?.send(visit) ?? { status: "failed", errorCode: "WHATSAPP_SENDER_UNAVAILABLE" };
  } };
  const protection = createContactProtection(process.env.BOOKING_DATA_KEY);
  const recipientForAppointment = async (appointmentId: string) => {
    const [appointment] = await db.select({ contactCiphertext: appointments.contactCiphertext }).from(appointments).where(eq(appointments.id, appointmentId));
    return appointment ? protection.decrypt(appointmentId, appointment.contactCiphertext).phone : null;
  };
  const worker = createWhatsAppDelivery(db, sender, () => new Date(), undefined, recipientForAppointment);
  try {
    do {
      const worked = fixedSender && cancellationSender
        ? await worker.runOnce("booking_created") || await worker.runOnce("appointment_cancelled")
        : fixedSender ? await worker.runOnce("booking_created") : await worker.runOnce("appointment_cancelled");
      if (!worked) {
        if (!process.argv.includes("--watch")) break;
        await setTimeout(2_000);
      }
    } while (!stopping);
  } finally { await pool.end(); }
}
main().catch(() => {
  process.stderr.write("WhatsApp worker stopped. Check test configuration and database; attempts are recorded in the database.\n");
  process.exitCode = 1;
});
