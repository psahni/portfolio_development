ALTER TABLE "whatsapp_notifications" DROP CONSTRAINT "whatsapp_event";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "whatsapp_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_event" CHECK ("whatsapp_notifications"."event" in ('booking_created', 'appointment_cancelled'));
