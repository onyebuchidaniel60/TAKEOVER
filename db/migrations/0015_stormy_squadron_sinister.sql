ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Phase 5j D16 grandfather: every pre-existing user counts as onboarded
-- (they predate the flow). New rows default to NULL via the column default.
UPDATE "users" SET "onboarded_at" = "created_at" WHERE "onboarded_at" IS NULL;