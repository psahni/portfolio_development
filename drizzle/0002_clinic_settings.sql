CREATE TABLE "clinic_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"timezone" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_settings_singleton" CHECK ("clinic_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "doctor_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer DEFAULT 20 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"min_lead_minutes" integer DEFAULT 60 NOT NULL,
	"booking_horizon_days" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "doctor_profile_singleton" CHECK ("doctor_profile"."id" = 1),
	CONSTRAINT "doctor_duration_range" CHECK ("doctor_profile"."duration_minutes" between 5 and 240),
	CONSTRAINT "doctor_buffer_before_range" CHECK ("doctor_profile"."buffer_before_minutes" between 0 and 120),
	CONSTRAINT "doctor_buffer_after_range" CHECK ("doctor_profile"."buffer_after_minutes" between 0 and 120),
	CONSTRAINT "doctor_lead_range" CHECK ("doctor_profile"."min_lead_minutes" between 0 and 10080),
	CONSTRAINT "doctor_horizon_range" CHECK ("doctor_profile"."booking_horizon_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "weekly_hours" (
	"doctor_id" integer NOT NULL,
	"day" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "weekly_hours_doctor_id_day_start_minute_pk" PRIMARY KEY("doctor_id","day","start_minute"),
	CONSTRAINT "weekly_hours_day" CHECK ("weekly_hours"."day" between 0 and 6),
	CONSTRAINT "weekly_hours_interval" CHECK ("weekly_hours"."start_minute" >= 0 and "weekly_hours"."end_minute" <= 1439 and "weekly_hours"."start_minute" < "weekly_hours"."end_minute")
);
--> statement-breakpoint
ALTER TABLE "doctor_profile" ADD CONSTRAINT "doctor_profile_id_clinic_settings_id_fk" FOREIGN KEY ("id") REFERENCES "public"."clinic_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_hours" ADD CONSTRAINT "weekly_hours_doctor_id_doctor_profile_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profile"("id") ON DELETE cascade ON UPDATE no action;