import { config } from "dotenv";
import { setTimeout } from "node:timers/promises";
import { createDatabase } from "../src/db/connection";
import { readAuthEnvironment } from "../src/platform/env";
import { createMetaWhatsApp, readWhatsAppConfig } from "../src/modules/notifications/meta";
import { createWhatsAppWorker } from "../src/modules/notifications/worker";

config({ path: ".env.local", quiet: true });
async function main() {
  const settings = readWhatsAppConfig();
  if (!settings) { process.stdout.write("WhatsApp is disabled. No messages sent.\n"); return; }
  const { db, pool } = createDatabase(readAuthEnvironment().DATABASE_URL);
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  const worker = createWhatsAppWorker(db, createMetaWhatsApp(settings));
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
