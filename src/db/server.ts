import "server-only";
import { createDatabase } from "./connection";
import { readAuthEnvironment } from "@/platform/env";

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase() {
  database ??= createDatabase(readAuthEnvironment().DATABASE_URL);
  return database;
}
