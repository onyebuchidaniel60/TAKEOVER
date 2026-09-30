ALTER TABLE "users" ADD COLUMN "tour_completed_at" timestamp with time zone;--> statement-breakpoint
-- Phase 5j-2 grandfather: every pre-existing user counts as tour-seen
-- (they predate the tour). New rows default to NULL via the column default.
UPDATE "users" SET "tour_completed_at" = "created_at" WHERE "tour_completed_at" IS NULL;