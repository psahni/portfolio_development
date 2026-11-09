CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" integer NOT NULL,
	"reservation_id" uuid,
	"patient_user_id" text,
	"created_by_staff_id" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"contact_ciphertext" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer NOT NULL,
	"buffer_after_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "appointment_single_doctor" CHECK ("appointments"."doctor_id" = 1),
	CONSTRAINT "appointment_source" CHECK (("appointments"."source" = 'patient' and "appointments"."patient_user_id" is not null and "appointments"."created_by_staff_id" is null) or ("appointments"."source" = 'clinic' and "appointments"."patient_user_id" is null and "appointments"."created_by_staff_id" is not null)),
	CONSTRAINT "appointment_status" CHECK ("appointments"."status" in ('confirmed', 'cancelled', 'completed', 'no_show')),
	CONSTRAINT "confirmed_appointment_reservation" CHECK ("appointments"."status" <> 'confirmed' or "appointments"."reservation_id" is not null),
	CONSTRAINT "appointment_duration" CHECK ("appointments"."duration_minutes" between 5 and 240 and "appointments"."ends_at" = "appointments"."starts_at" + "appointments"."duration_minutes" * interval '1 minute'),
	CONSTRAINT "appointment_buffers" CHECK ("appointments"."buffer_before_minutes" between 0 and 120 and "appointments"."buffer_after_minutes" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE "booking_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"action" text DEFAULT 'created' NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_audit_creation" UNIQUE("appointment_id","action"),
	CONSTRAINT "booking_audit_action" CHECK ("booking_audit"."action" = 'created'),
	CONSTRAINT "booking_audit_actor" CHECK ("booking_audit"."actor_kind" in ('patient', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"appointment_id" uuid NOT NULL,
	"receipt" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_requests_actor_kind_actor_id_request_id_pk" PRIMARY KEY("actor_kind","actor_id","request_id"),
	CONSTRAINT "booking_request_actor" CHECK ("booking_requests"."actor_kind" in ('patient', 'staff')),
	CONSTRAINT "booking_request_expiry" CHECK ("booking_requests"."expires_at" > "booking_requests"."created_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctor_profile_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_user_id_user_id_fk" FOREIGN KEY ("patient_user_id") REFERENCES "patient_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_staff_id_user_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_audit" ADD CONSTRAINT "booking_audit_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_doctor_start" ON "appointments" USING btree ("doctor_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_patient_start" ON "appointments" USING btree ("patient_user_id","starts_at");