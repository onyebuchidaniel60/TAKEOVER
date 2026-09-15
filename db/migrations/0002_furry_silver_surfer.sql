CREATE TYPE "public"."escrow_entry_type" AS ENUM('deposit', 'release', 'refund');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('created', 'funded', 'delivered', 'disputed', 'released', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_token" AS ENUM('NIM', 'USDT_POLYGON');--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'deposit_submitted' BEFORE 'payment_pending';--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'escrow_funded';--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'disputed';--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'released';--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'refunded';