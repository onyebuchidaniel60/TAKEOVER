import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userRole, userStatus } from './enums';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull().unique(),
  role: userRole('role').notNull().default('buyer'),
  status: userStatus('status').notNull().default('active'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
