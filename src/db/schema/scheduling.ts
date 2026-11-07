import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { doctorProfile } from "./clinic";
import type { TimeInterval } from "@/modules/scheduling/models";

export const dayOverrides = pgTable("day_overrides", {
  doctorId: integer("doctor_id").notNull().references(() => doctorProfile.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  mode: text("mode").$type<"closed" | "custom">().notNull(),
  intervals: jsonb("intervals").$type<TimeInterval[]>().notNull().default([]),
  reason: text("reason").notNull().default(""),
}, (table) => [
  primaryKey({ columns: [table.doctorId, table.date] }),
  check("day_override_mode", sql`(${table.mode} = 'closed' and jsonb_array_length(${table.intervals}) = 0) or (${table.mode} = 'custom' and jsonb_array_length(${table.intervals}) between 1 and 8)`),
]);

export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  doctorId: integer("doctor_id").notNull().references(() => doctorProfile.id, { onDelete: "cascade" }),
  // The shared booking task will create appointment occupancy in the same table.
  kind: text("kind").$type<"block" | "appointment">().notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull().default(""),
}, (table) => [
  check("reservation_single_doctor", sql`${table.doctorId} = 1`),
  check("reservation_kind", sql`${table.kind} in ('block', 'appointment')`),
  check("reservation_positive_interval", sql`${table.startsAt} < ${table.endsAt}`),
  index("reservation_doctor_start").on(table.doctorId, table.startsAt),
  // PostgreSQL range exclusion is added explicitly in 0003; Drizzle has no exclusion builder.
]);
