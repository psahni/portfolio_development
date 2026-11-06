import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const clinicSettings = pgTable("clinic_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  timezone: text("timezone").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("clinic_settings_singleton", sql`${table.id} = 1`)]);

export const doctorProfile = pgTable("doctor_profile", {
  id: integer("id").primaryKey().default(1).references(() => clinicSettings.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(20),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  minLeadMinutes: integer("min_lead_minutes").notNull().default(60),
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(30),
}, (table) => [
  check("doctor_profile_singleton", sql`${table.id} = 1`),
  check("doctor_duration_range", sql`${table.durationMinutes} between 5 and 240`),
  check("doctor_buffer_before_range", sql`${table.bufferBeforeMinutes} between 0 and 120`),
  check("doctor_buffer_after_range", sql`${table.bufferAfterMinutes} between 0 and 120`),
  check("doctor_lead_range", sql`${table.minLeadMinutes} between 0 and 10080`),
  check("doctor_horizon_range", sql`${table.bookingHorizonDays} between 1 and 365`),
]);

export const weeklyHours = pgTable("weekly_hours", {
  doctorId: integer("doctor_id").notNull().references(() => doctorProfile.id, { onDelete: "cascade" }),
  // Monday = 0 through Sunday = 6; values are local wall-clock minutes, not UTC instants.
  day: integer("day").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
}, (table) => [
  primaryKey({ columns: [table.doctorId, table.day, table.startMinute] }),
  check("weekly_hours_day", sql`${table.day} between 0 and 6`),
  check("weekly_hours_interval", sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1439 and ${table.startMinute} < ${table.endMinute}`),
]);
