import { config } from "dotenv";
import { z } from "zod";
import { createDatabase } from "../src/db/connection";
import { readAuthEnvironment, readMigrationUrl } from "../src/platform/env";
import { bootstrapAdmin } from "../src/modules/identity/admin-pin";

config({ path: ".env.local", quiet: true });

async function main() {
  const env = readAuthEnvironment();
  const input = z.object({
    BOOTSTRAP_ADMIN_EMAIL: z.email(), BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).default("Doctor"),
    BOOTSTRAP_ADMIN_PIN: z.string().regex(/^\d{4}$/).refine((value) => value !== "0000"),
  }).safeParse(process.env);
  if (!input.success) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a four-digit BOOTSTRAP_ADMIN_PIN (not 0000) in .env.local.");
  const { db, pool } = createDatabase(readMigrationUrl(), 1);
  try {
    const result = await bootstrapAdmin(db, { email: input.data.BOOTSTRAP_ADMIN_EMAIL, name: input.data.BOOTSTRAP_ADMIN_NAME, pin: input.data.BOOTSTRAP_ADMIN_PIN, staffSecret: env.STAFF_AUTH_SECRET });
    process.stdout.write(result.created ? "Admin created. No staff or patients were created.\n" : "Admin already exists; PIN unchanged.\n");
  } finally { await pool.end(); }
}

main().catch(() => {
  process.stderr.write("Admin bootstrap failed. Check migrations, local configuration and whether an admin already exists. Credentials are never printed.\n");
  process.exitCode = 1;
});
