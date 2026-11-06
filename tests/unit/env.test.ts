import { describe, expect, it, vi } from "vitest";
import { readAuthEnvironment, readMigrationUrl } from "@/platform/env";
import { unconfiguredMailer } from "@/platform/mail";

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://dev:private-password@localhost:5432/test",
  PATIENT_AUTH_SECRET: "a".repeat(48),
  STAFF_AUTH_SECRET: "b".repeat(48),
};

describe("server configuration", () => {
  it("accepts distinct secrets and PostgreSQL configuration", () => {
    expect(readAuthEnvironment(valid)).toEqual(valid);
  });
  it("reports missing field names without printing input values", () => {
    expect(() => readAuthEnvironment({ ...valid, DATABASE_URL: "secret-database-value", STAFF_AUTH_SECRET: "private-short-secret" })).toThrow("DATABASE_URL, STAFF_AUTH_SECRET");
    try { readAuthEnvironment({ ...valid, DATABASE_URL: "secret-database-value" }); }
    catch (error) { expect(String(error)).not.toContain("secret-database-value"); }
  });
  it("rejects shared patient/staff signing secrets", () => {
    expect(() => readAuthEnvironment({ ...valid, STAFF_AUTH_SECRET: valid.PATIENT_AUTH_SECRET })).toThrow("STAFF_AUTH_SECRET");
  });
  it.each(["https://site.test/path", "ftp://site.test", "https://user:password@site.test", "https://site.test?secret=yes"])("rejects unsafe application origin %s", (APP_URL) => {
    expect(() => readAuthEnvironment({ ...valid, APP_URL })).toThrow("APP_URL");
  });
  it("requires HTTPS for production authentication", () => {
    vi.stubEnv("NODE_ENV", "production");
    try { expect(() => readAuthEnvironment(valid)).toThrow("APP_URL"); }
    finally { vi.unstubAllEnvs(); }
  });
  it("requires explicit migration credentials instead of using runtime credentials", () => {
    expect(() => readMigrationUrl(valid)).toThrow("MIGRATION_DATABASE_URL");
  });
  it("fails closed when email delivery is not configured", async () => {
    await expect(unconfiguredMailer.sendPatientLoginCode({ email: "synthetic@example.test", code: "123456" })).rejects.toThrow("not configured");
  });
});
