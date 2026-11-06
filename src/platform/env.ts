import { z } from "zod";
import { resolveTestAuthMode } from "../modules/identity/test-mode";

function parsedUrl(value: string) {
  try { return new URL(value); }
  catch { return null; }
}

const authEnvironment = z.object({
  APP_URL: z.url().refine((value) => {
    const url = parsedUrl(value);
    return !!url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  }),
  DATABASE_URL: z.string().url().refine((value) => ["postgres:", "postgresql:"].includes(parsedUrl(value)?.protocol ?? "")),
  PATIENT_AUTH_SECRET: z.string().min(32),
  STAFF_AUTH_SECRET: z.string().min(32),
  AUTH_TEST_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).superRefine((value, ctx) => {
  if (value.PATIENT_AUTH_SECRET === value.STAFF_AUTH_SECRET) {
    ctx.addIssue({ code: "custom", path: ["STAFF_AUTH_SECRET"], message: "Use a distinct secret" });
  }
  if (process.env.NODE_ENV === "production" && !value.APP_URL.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "HTTPS required" });
  }
  if (value.AUTH_TEST_MODE) {
    try { resolveTestAuthMode(true, value.APP_URL); }
    catch { ctx.addIssue({ code: "custom", path: ["AUTH_TEST_MODE"], message: "Local development/test only" }); }
  }
});

export function readAuthEnvironment(source: Record<string, string | undefined> = process.env) {
  const result = authEnvironment.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}. See .env.example.`);
  }
  return result.data;
}

export function readMigrationUrl(source: Record<string, string | undefined> = process.env) {
  const value = source.MIGRATION_DATABASE_URL;
  if (!value || !["postgres:", "postgresql:"].includes(parsedUrl(value)?.protocol ?? "")) {
    throw new Error("Invalid server configuration: MIGRATION_DATABASE_URL. See .env.example.");
  }
  return value;
}
