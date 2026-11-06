import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });
// Generating SQL requires no live credentials. Applying SQL uses scripts/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/auth.ts",
  out: "./drizzle",
  strict: true,
  verbose: false,
});
