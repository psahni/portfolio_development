import "server-only";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { patientAuthTables, staffAuthTables, staffAccess, staffUser } from "@/db/schema/auth";
import type { AuthMailer } from "@/platform/mail";
import { adminPinPlugin } from "./admin-pin-plugin";
import { resolveTestAuthMode, TEST_LOGIN_CODE } from "./test-mode";
import { createAccessChecks } from "./access";

type AuthConfiguration = {
  db: ApplicationDatabase;
  baseURL: string;
  patientSecret: string;
  staffSecret: string;
  mailer: AuthMailer;
  testMode?: boolean;
};

/** Separate auth boundaries; staff login is mounted in M2.2, patient login remains M4. */
export function createIdentity({ db, baseURL, patientSecret, staffSecret, mailer, testMode = false }: AuthConfiguration) {
  if (patientSecret === staffSecret || Math.min(patientSecret.length, staffSecret.length) < 32) {
    throw new Error("Distinct patient and staff authentication secrets of at least 32 characters are required.");
  }
  const testing = resolveTestAuthMode(testMode, baseURL);
  const codeOptions = {
    otpLength: testing ? 4 : 6,
    expiresIn: 300,
    allowedAttempts: 3,
    storeOTP: "hashed" as const,
    ...(testing ? { generateOTP: () => TEST_LOGIN_CODE } : {}),
  };
  const shared = {
    baseURL,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },
    logger: { disabled: true },
    session: { expiresIn: 60 * 60 * 12, cookieCache: { enabled: false } },
    // Existing per-process limits; shared database-backed abuse policies are M6 work.
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
      ...codeOptions,
      disableSignUp: testing,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") throw new Error("Unsupported patient verification request.");
        if (!testing) await mailer.sendPatientLoginCode({ email, code: otp });
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
    emailAndPassword: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (["/sign-in/email-otp", "/email-otp/send-verification-otp"].includes(ctx.path)) {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
          const [access] = await db.select({ id: staffAccess.userId }).from(staffAccess)
            .innerJoin(staffUser, eq(staffUser.id, staffAccess.userId))
            .where(and(eq(staffUser.email, email), eq(staffAccess.role, "staff"), eq(staffAccess.active, true)));
          if (!access || (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "sign-in")) {
            throw new APIError("UNAUTHORIZED", { message: "Unable to sign in or verify access." });
          }
        }
      }),
    },
    databaseHooks: {
      session: { create: { before: async (session) => {
        const [access] = await db.select().from(staffAccess).where(and(eq(staffAccess.userId, session.userId), eq(staffAccess.active, true)));
        return access ? { data: session } : false;
      } } },
    },
    plugins: [emailOTP({
      ...codeOptions,
      disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") throw new Error("Unsupported staff verification request.");
        if (!testing) await mailer.sendStaffLoginCode({ email, code: otp });
      },
    }), adminPinPlugin(db, { staffSecret, testMode: testing, baseURL })],
  });

  const access = createAccessChecks(db, staff);
  return { patient, staff, access };
}
