import { config } from "dotenv";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "../src/db/connection";
import { readAuthEnvironment } from "../src/platform/env";
import { createMetaWhatsApp, readWhatsAppConfig, isWhatsAppWorkerEnabled } from "../src/modules/notifications/meta";
import { createWhatsAppDelivery } from "../src/modules/notifications/delivery";

config({ path: ".env.local", quiet: true });
async function main() {
  if (!isWhatsAppWorkerEnabled()) { process.stdout.write("WhatsApp request delivery is selected. Worker will not send.\n"); return; }
  const settings = readWhatsAppConfig();
  if (!settings) { process.stdout.write("WhatsApp is disabled. No messages sent.\n"); return; }
  const { db, pool } = createDatabase(readAuthEnvironment().DATABASE_URL);
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  const worker = createWhatsAppDelivery(db, createMetaWhatsApp(settings));
  try {
    do {
      const worked = await worker.runOnce();
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
