CREATE TABLE "whatsapp_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"api_message_id" text,
	"error_code" text,
	CONSTRAINT "whatsapp_attempt_number" UNIQUE("notification_id","number"),
	CONSTRAINT "whatsapp_attempt_status" CHECK ("whatsapp_attempts"."status" in ('sending', 'accepted', 'failed', 'uncertain', 'suppressed')),
	CONSTRAINT "whatsapp_attempt_number_positive" CHECK ("whatsapp_attempts"."number" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_consents" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"consented" boolean NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "whatsapp_consent_withdrawal" CHECK (("whatsapp_consents"."withdrawn" = false and "whatsapp_consents"."withdrawn_at" is null) or ("whatsapp_consents"."consented" = true and "whatsapp_consents"."withdrawn" = true and "whatsapp_consents"."withdrawn_at" >= "whatsapp_consents"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"event" text DEFAULT 'booking_created' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"api_message_id" text,
	"error_code" text,
	CONSTRAINT "whatsapp_appointment_event" UNIQUE("appointment_id","event"),
	CONSTRAINT "whatsapp_event" CHECK ("whatsapp_notifications"."event" = 'booking_created'),
	CONSTRAINT "whatsapp_status" CHECK ("whatsapp_notifications"."status" in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'suppressed')),
	CONSTRAINT "whatsapp_attempt_count" CHECK ("whatsapp_notifications"."attempts" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_attempts" ADD CONSTRAINT "whatsapp_attempts_notification_id_whatsapp_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."whatsapp_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_consents" ADD CONSTRAINT "whatsapp_consents_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;