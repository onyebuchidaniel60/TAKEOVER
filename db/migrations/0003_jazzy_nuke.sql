CREATE TABLE IF NOT EXISTS "escrow_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escrow_id" uuid NOT NULL,
	"entry_type" "escrow_entry_type" NOT NULL,
	"debit_account" text NOT NULL,
	"credit_account" text NOT NULL,
	"amount_base_units" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escrows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"payment_token" "payment_token" NOT NULL,
	"amount_base_units" bigint NOT NULL,
	"status" "escrow_status" DEFAULT 'created' NOT NULL,
	"deposit_tx_hash" text,
	"release_tx_hash" text,
	"refund_tx_hash" text,
	"contract_address" text,
	"on_chain_escrow_id" text,
	"funded_at" timestamp with time zone,
	"delivery_deadline" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"dispute_window_ends" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrows_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "escrows_deposit_tx_hash_unique" UNIQUE("deposit_tx_hash"),
	CONSTRAINT "escrows_release_tx_hash_unique" UNIQUE("release_tx_hash"),
	CONSTRAINT "escrows_refund_tx_hash_unique" UNIQUE("refund_tx_hash"),
	CONSTRAINT "escrows_funded_fields_check" CHECK ("escrows"."status" = 'created' OR ("escrows"."deposit_tx_hash" IS NOT NULL AND "escrows"."funded_at" IS NOT NULL AND "escrows"."delivery_deadline" IS NOT NULL))
);
--> statement-breakpoint
DROP INDEX IF EXISTS "claims_one_active_per_buyer_slot";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escrow_ledger" ADD CONSTRAINT "escrow_ledger_escrow_id_escrows_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escrows" ADD CONSTRAINT "escrows_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escrows" ADD CONSTRAINT "escrows_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escrows" ADD CONSTRAINT "escrows_provider_id_users_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escrows" ADD CONSTRAINT "escrows_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escrows_status_idx" ON "escrows" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claims_one_active_per_buyer_slot" ON "claims" USING btree ("slot_id","buyer_id") WHERE "claims"."status" IN ('active_hold', 'deposit_submitted', 'payment_pending', 'payment_review');