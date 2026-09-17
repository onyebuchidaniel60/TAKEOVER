ALTER TABLE "slots" ADD COLUMN "listing_fee_tx_hash" text;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "listing_fee_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_listing_fee_tx_hash_unique" UNIQUE("listing_fee_tx_hash");