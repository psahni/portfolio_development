import { describe, expect, it, vi } from "vitest";
import { readAuthEnvironment, readMigrationUrl } from "@/platform/env";
import { unconfiguredMailer } from "@/platform/mail";
import { resolveTestAuthMode } from "@/modules/identity/test-mode";

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://dev:private-password@localhost:5432/test",
  PATIENT_AUTH_SECRET: "a".repeat(48),
  STAFF_AUTH_SECRET: "b".repeat(48),
};

describe("server configuration", () => {
  it("accepts distinct secrets and PostgreSQL configuration", () => {
    expect(readAuthEnvironment(valid)).toEqual({ ...valid, AUTH_TEST_MODE: false });
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
    await expect(unconfiguredMailer.sendStaffLoginCode({ email: "staff@example.test", code: "123456" })).rejects.toThrow("not configured");
  });
  it("requires an explicit test flag and loopback origin", () => {
    expect(readAuthEnvironment({ ...valid, AUTH_TEST_MODE: "true" }).AUTH_TEST_MODE).toBe(true);
    expect(() => readAuthEnvironment({ ...valid, APP_URL: "https://clinic.example.test", AUTH_TEST_MODE: "true" })).toThrow("AUTH_TEST_MODE");
    expect(() => readAuthEnvironment({ ...valid, AUTH_TEST_MODE: "yes" })).toThrow("AUTH_TEST_MODE");
    expect(resolveTestAuthMode(false, "https://clinic.example.test")).toBe(false);
  });
  it("rejects test authentication in production even with a localhost origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => readAuthEnvironment({ ...valid, APP_URL: "https://localhost", AUTH_TEST_MODE: "true" })).toThrow("AUTH_TEST_MODE");
      expect(() => resolveTestAuthMode(true, "https://localhost")).toThrow("only for local");
    } finally { vi.unstubAllEnvs(); }
  });
});
