import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { paymentStatus } from './enums';
import { claims } from './claims';

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .unique()
      .references(() => claims.id),
    expectedAmountNim: bigint('expected_amount_nim', { mode: 'bigint' }).notNull(),
    expectedRecipient: text('expected_recipient').notNull(),
    expectedSender: text('expected_sender').notNull(),
    expectedData: text('expected_data').notNull(),
    status: paymentStatus('status').notNull().default('created'),
    // Nullable but unique when present: the same on-chain tx can never settle two claims.
    txHash: text('tx_hash'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_intents_tx_hash_unique').on(t.txHash),
    index('payment_intents_status_idx').on(t.status),
  ],
);
