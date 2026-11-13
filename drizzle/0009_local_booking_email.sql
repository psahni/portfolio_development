CREATE TABLE "local_booking_emails" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"logged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "local_booking_emails" ADD CONSTRAINT "local_booking_emails_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;