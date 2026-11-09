import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/connection";
import { patientUser } from "../src/db/schema/auth";
import { readAuthEnvironment } from "../src/platform/env";

config({ path: ".env.local", quiet: true });
let database: ReturnType<typeof createDatabase> | undefined;
try {
  const env = readAuthEnvironment();
  const hostname = new URL(env.DATABASE_URL).hostname;
  if (!env.AUTH_TEST_MODE || !["127.0.0.1", "localhost", "[::1]"].includes(hostname)) throw new Error();
  database = createDatabase(env.DATABASE_URL);
  await database.db.insert(patientUser).values({ id: randomUUID(), name: "Synthetic Patient", email: "patient@example.test" }).onConflictDoNothing({ target: patientUser.email });
  process.stdout.write("Local test patient ready: patient@example.test. Request a code at /login, then enter 0000.\n");
} catch {
  process.stderr.write("Test patient was not seeded. Use localhost development/test mode, a local database and applied migrations.\n");
  process.exitCode = 1;
} finally { await database?.pool.end(); }
