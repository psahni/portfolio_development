import { boolean, pgSchema, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

export const patientAuthSchema = pgSchema("patient_auth");
export const staffAuthSchema = pgSchema("staff_auth");

// Separate identities and credentials: a patient OTP never authenticates a staff user.
function authTables(schema: PgSchema) {
  const user = schema.table("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  const session = schema.table("session", {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  });
  const account = schema.table("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  const verification = schema.table("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  return { user, session, account, verification };
}

export const patientAuthTables = authTables(patientAuthSchema);
export const staffAuthTables = authTables(staffAuthSchema);
// Explicit table exports let Drizzle Kit discover all migration entities.
export const patientUser = patientAuthTables.user;
export const patientSession = patientAuthTables.session;
export const patientAccount = patientAuthTables.account;
export const patientVerification = patientAuthTables.verification;
export const staffUser = staffAuthTables.user;
export const staffSession = staffAuthTables.session;
export const staffAccount = staffAuthTables.account;
export const staffVerification = staffAuthTables.verification;
