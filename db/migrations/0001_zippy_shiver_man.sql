DROP INDEX IF EXISTS "claims_one_active_per_buyer_slot";--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution_notes" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claims_one_active_per_buyer_slot" ON "claims" USING btree ("slot_id","buyer_id") WHERE "claims"."status" IN ('active_hold', 'payment_pending', 'payment_review');--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_quantity_check" CHECK ("claims"."quantity" > 0);