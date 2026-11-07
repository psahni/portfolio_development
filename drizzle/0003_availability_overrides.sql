CREATE TABLE "day_overrides" (
	"doctor_id" integer NOT NULL,
	"date" date NOT NULL,
	"mode" text NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "day_overrides_doctor_id_date_pk" PRIMARY KEY("doctor_id","date"),
	CONSTRAINT "day_override_mode" CHECK (("day_overrides"."mode" = 'closed' and jsonb_array_length("day_overrides"."intervals") = 0) or ("day_overrides"."mode" = 'custom' and jsonb_array_length("day_overrides"."intervals") between 1 and 8))
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" integer NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "reservation_single_doctor" CHECK ("reservations"."doctor_id" = 1),
	CONSTRAINT "reservation_kind" CHECK ("reservations"."kind" in ('block', 'appointment')),
	CONSTRAINT "reservation_positive_interval" CHECK ("reservations"."starts_at" < "reservations"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "day_overrides" ADD CONSTRAINT "day_overrides_doctor_id_doctor_profile_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_doctor_id_doctor_profile_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_doctor_start" ON "reservations" USING btree ("doctor_id","starts_at");--> statement-breakpoint
-- Single-doctor MVP: GiST's built-in range operator prevents any overlapping occupancy.
-- No btree_gist extension is needed because doctor_id is constrained to 1.
ALTER TABLE "reservations" ADD CONSTRAINT "reservation_no_overlap"
  EXCLUDE USING gist (tstzrange("starts_at", "ends_at", '[)') WITH &&);
