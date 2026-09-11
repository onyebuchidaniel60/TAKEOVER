import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reportStatus } from './enums';
import { slots } from './slots';
import { users } from './users';

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id),
  slotId: uuid('slot_id').references(() => slots.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  reason: text('reason').notNull(),
  details: text('details'),
  status: reportStatus('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});
