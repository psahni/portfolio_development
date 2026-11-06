CREATE TABLE "staff_access" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"admin_pin_hash" text,
	"failed_pin_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_access_role" CHECK ("staff_access"."role" in ('admin', 'staff')),
	CONSTRAINT "staff_access_pin_owner" CHECK (("staff_access"."role" = 'admin' and "staff_access"."admin_pin_hash" is not null) or ("staff_access"."role" = 'staff' and "staff_access"."admin_pin_hash" is null)),
	CONSTRAINT "staff_access_pin_attempts" CHECK ("staff_access"."failed_pin_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff_access" ADD CONSTRAINT "staff_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "staff_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_access_one_admin" ON "staff_access" USING btree ("role") WHERE "staff_access"."role" = 'admin';