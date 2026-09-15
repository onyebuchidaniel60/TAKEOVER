import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { claimStatus } from './enums';
import { slots } from './slots';
import { users } from './users';

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    quantity: integer('quantity').notNull().default(1),
    status: claimStatus('status').notNull().default('active_hold'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('claims_quantity_check', sql`${t.quantity} > 0`),
    // One live (hold/deposit/pending/review) claim per buyer+slot; paid/expired/cancelled rows may repeat.
    uniqueIndex('claims_one_active_per_buyer_slot')
      .on(t.slotId, t.buyerId)
      .where(sql`${t.status} IN ('active_hold', 'deposit_submitted', 'payment_pending', 'payment_review')`),
    index('claims_slot_buyer_status_idx').on(t.slotId, t.buyerId, t.status),
  ],
);
