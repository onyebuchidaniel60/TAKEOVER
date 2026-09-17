import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { slotStatus } from './enums';
import { users } from './users';

export const slots = pgTable(
  'slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    // Phase 14d-4: one-way provider contact note. Nullable; NULL means unset.
    // Plain TEXT at DB level (no CHECK — consistent with title/description/
    // resolution_notes); length 1–500 and the no-URLs rule are enforced at
    // the API boundary. Visible to the buyer only once the claim's escrow
    // reaches a funded-side status (see the claim/escrow view gates).
    providerContactNote: text('provider_contact_note'),
    category: text('category'),
    locationLabel: text('location_label'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Integer NIM base units only — never floats.
    priceNim: bigint('price_nim', { mode: 'bigint' }).notNull(),
    totalQuantity: integer('total_quantity').notNull(),
    availableQuantity: integer('available_quantity').notNull(),
    payoutWallet: text('payout_wallet').notNull(),
    status: slotStatus('status').notNull().default('draft'),
    // Phase 14g-1: NIM listing-fee receipt. NULL = unpaid (pre-fee slot or
    // fee-not-configured publish). UNIQUE when present: the same on-chain fee
    // transfer can never publish two slots (replay backstop; Postgres treats
    // NULLs as distinct, so unpaid rows never collide).
    listingFeeTxHash: text('listing_fee_tx_hash').unique(),
    listingFeePaidAt: timestamp('listing_fee_paid_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('slots_total_qty_check', sql`${t.totalQuantity} > 0`),
    check(
      'slots_avail_qty_check',
      sql`${t.availableQuantity} >= 0 AND ${t.availableQuantity} <= ${t.totalQuantity}`,
    ),
    check('slots_price_check', sql`${t.priceNim} > 0`),
    index('slots_status_starts_at_idx').on(t.status, t.startsAt),
  ],
);
