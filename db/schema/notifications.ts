import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

// Phase 14l-2: in-app notifications. Two events only: a funded escrow
// (provider is told to deliver) and a delivered escrow (buyer is told to
// confirm). Rows are written INSIDE the same DB transaction as the state
// change they describe — notification and action succeed or fail together.
// Bodies carry display text only (truncated identifiers, never full
// wallets, tx hashes, or secrets).
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    // 'slot_funded' | 'slot_delivered' — validated in the service layer.
    type: text('type').notNull(),
    // 'claim' | 'slot' | 'escrow' — validated in the service layer.
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);
