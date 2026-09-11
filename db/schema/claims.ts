import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    status: claimStatus('status').notNull().default('active_hold'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live claim per buyer+slot: second hold/payment/paid/review rows are rejected.
    uniqueIndex('claims_one_active_per_buyer_slot')
      .on(t.slotId, t.buyerId)
      .where(sql`${t.status} IN ('active_hold', 'payment_pending', 'paid', 'payment_review')`),
    index('claims_slot_buyer_status_idx').on(t.slotId, t.buyerId, t.status),
  ],
);
