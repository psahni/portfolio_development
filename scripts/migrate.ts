import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../src/db/connection";
import { readMigrationUrl } from "../src/platform/env";

config({ path: ".env.local", quiet: true });

async function main() {
  const { db, pool } = createDatabase(readMigrationUrl(), 1);
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    process.stdout.write("Database migrations applied.\n");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Migration failed. Check database availability, credentials and migration history.\n");
  process.exitCode = 1;
});
