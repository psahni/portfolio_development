import "server-only";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { ApplicationDatabase } from "@/db/connection";
import { patientAuthTables, staffAuthTables } from "@/db/schema/auth";
import type { AuthMailer } from "@/platform/mail";

type AuthConfiguration = {
  db: ApplicationDatabase;
  baseURL: string;
  patientSecret: string;
  staffSecret: string;
  mailer: AuthMailer;
};

/** M1 feasibility boundary. Public handlers and business authorization are added in M2/M4. */
export function createIdentity({ db, baseURL, patientSecret, staffSecret, mailer }: AuthConfiguration) {
  if (patientSecret === staffSecret || Math.min(patientSecret.length, staffSecret.length) < 32) {
    throw new Error("Distinct patient and staff authentication secrets of at least 32 characters are required.");
  }
  const shared = {
    baseURL,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },
    logger: { disabled: true },
    session: { expiresIn: 60 * 60 * 12, cookieCache: { enabled: false } },
    // M2 adds shared database-backed abuse policies before public handlers are mounted.
    rateLimit: { enabled: true, window: 60, max: 10 },
  } satisfies BetterAuthOptions;

  const patient = betterAuth({
    ...shared,
    appName: "Nuvortiq Patient",
    secret: patientSecret,
    basePath: "/api/auth/patient",
    database: drizzleAdapter(db, { provider: "pg", schema: patientAuthTables }),
    advanced: { cookiePrefix: "nuvortiq-patient", useSecureCookies: baseURL.startsWith("https:") },
    emailAndPassword: { enabled: false },
    plugins: [emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") throw new Error("Unsupported patient verification request.");
        await mailer.sendPatientLoginCode({ email, code: otp });
      },
    })],
  });

  const staff = betterAuth({
    ...shared,
    appName: "Nuvortiq Clinic",
    secret: staffSecret,
    basePath: "/api/auth/staff",
    database: drizzleAdapter(db, { provider: "pg", schema: staffAuthTables }),
    advanced: { cookiePrefix: "nuvortiq-staff", useSecureCookies: baseURL.startsWith("https:") },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, revokeSessionsOnPasswordReset: true },
  });

  return { patient, staff };
}
