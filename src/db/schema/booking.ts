import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { patientUser, staffUser } from "./auth";
import { doctorProfile } from "./clinic";
import { reservations } from "./scheduling";
import type { BookingReceipt } from "@/modules/booking/models";

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  doctorId: integer("doctor_id").notNull().references(() => doctorProfile.id),
  // A future cancellation can detach/release occupancy while retaining appointment history.
  reservationId: uuid("reservation_id").unique().references(() => reservations.id),
  patientUserId: text("patient_user_id").references(() => patientUser.id),
  createdByStaffId: text("created_by_staff_id").references(() => staffUser.id),
  source: text("source").$type<"patient" | "clinic">().notNull(),
  status: text("status").$type<"confirmed" | "cancelled" | "completed" | "no_show">().notNull().default("confirmed"),
  contactCiphertext: text("contact_ciphertext").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull(),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("appointment_single_doctor", sql`${table.doctorId} = 1`),
  check("appointment_source", sql`(${table.source} = 'patient' and ${table.patientUserId} is not null and ${table.createdByStaffId} is null) or (${table.source} = 'clinic' and ${table.patientUserId} is null and ${table.createdByStaffId} is not null)`),
  check("appointment_status", sql`${table.status} in ('confirmed', 'cancelled', 'completed', 'no_show')`),
  check("confirmed_appointment_reservation", sql`${table.status} <> 'confirmed' or ${table.reservationId} is not null`),
  check("appointment_duration", sql`${table.durationMinutes} between 5 and 240 and ${table.endsAt} = ${table.startsAt} + ${table.durationMinutes} * interval '1 minute'`),
  check("appointment_buffers", sql`${table.bufferBeforeMinutes} between 0 and 120 and ${table.bufferAfterMinutes} between 0 and 120`),
  index("appointment_doctor_start").on(table.doctorId, table.startsAt),
  index("appointment_patient_start").on(table.patientUserId, table.startsAt),
]);

export const bookingAudit = pgTable("booking_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  action: text("action").notNull().default("created"),
  actorKind: text("actor_kind").$type<"patient" | "staff">().notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("booking_audit_creation").on(table.appointmentId, table.action),
  check("booking_audit_action", sql`${table.action} = 'created'`),
  check("booking_audit_actor", sql`${table.actorKind} in ('patient', 'staff')`),
]);

export const bookingRequests = pgTable("booking_requests", {
  actorKind: text("actor_kind").$type<"patient" | "staff">().notNull(),
  actorId: text("actor_id").notNull(),
  requestId: uuid("request_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  // Original confirmation survives later appointment changes; never include contacts here.
  receipt: jsonb("receipt").$type<BookingReceipt>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.actorKind, table.actorId, table.requestId] }),
  check("booking_request_actor", sql`${table.actorKind} in ('patient', 'staff')`),
  check("booking_request_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
]);
