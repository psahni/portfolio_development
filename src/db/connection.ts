import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(connectionString: string, maxConnections = 5) {
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Do not log the raw error: connection strings/credentials can be in provider errors.
  pool.on("error", () => process.stderr.write("Unexpected idle database connection error.\n"));
  return { db: drizzle(pool), pool };
}

export type ApplicationDatabase = ReturnType<typeof createDatabase>["db"];
