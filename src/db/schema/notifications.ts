import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appointments } from "./booking";

export const whatsappConsents = pgTable("whatsapp_consents", {
  appointmentId: uuid("appointment_id").primaryKey().references(() => appointments.id, { onDelete: "cascade" }),
  consented: boolean("consented").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  withdrawn: boolean("withdrawn").notNull().default(false),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
}, (t) => [check("whatsapp_consent_withdrawal", sql`(${t.withdrawn} = false and ${t.withdrawnAt} is null) or (${t.consented} = true and ${t.withdrawn} = true and ${t.withdrawnAt} >= ${t.recordedAt})`)]);

export type NotificationStatus = "pending" | "sending" | "accepted" | "failed" | "uncertain" | "suppressed";
export const whatsappNotifications = pgTable("whatsapp_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  event: text("event").notNull().default("booking_created"),
  status: text("status").$type<NotificationStatus>().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  apiMessageId: text("api_message_id"),
  errorCode: text("error_code"),
}, (t) => [unique("whatsapp_appointment_event").on(t.appointmentId, t.event),
  check("whatsapp_event", sql`${t.event} in ('booking_created', 'appointment_cancelled')`),
  check("whatsapp_status", sql`${t.status} in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'suppressed')`),
  check("whatsapp_attempt_count", sql`${t.attempts} between 0 and 3`)]);

export const whatsappAttempts = pgTable("whatsapp_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull().references(() => whatsappNotifications.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  status: text("status").$type<NotificationStatus>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  apiMessageId: text("api_message_id"),
  errorCode: text("error_code"),
}, (t) => [unique("whatsapp_attempt_number").on(t.notificationId, t.number),
  check("whatsapp_attempt_status", sql`${t.status} in ('sending', 'accepted', 'failed', 'uncertain', 'suppressed')`),
  check("whatsapp_attempt_number_positive", sql`${t.number} between 1 and 3`)]);

// Local-only preview jobs. No patient contacts or real delivery status are stored here.
export const localBookingEmails = pgTable("local_booking_emails", {
  appointmentId: uuid("appointment_id").primaryKey().references(() => appointments.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }),
});

// Sender identifiers are keyed hashes; conversation contents are encrypted by the service.
export const whatsappConversations = pgTable("whatsapp_conversations", {
  senderHash: text("sender_hash").primaryKey(),
  state: text("state").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("whatsapp_conversation_state", sql`${t.state} in ('MAIN_MENU', 'WAITING_FOR_NAME', 'WAITING_FOR_EMAIL', 'WAITING_FOR_CODE', 'SELECTING_DATE', 'SELECTING_SLOT', 'CONFIRMING_BOOKING', 'BOOKING_COMPLETED', 'SUPPORT_REQUESTED')`)]);

export const whatsappWebhookMessages = pgTable("whatsapp_webhook_messages", {
  messageId: text("message_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
