import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userRole, userStatus } from './enums';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull().unique(),
  // Optional profile picture as a base64 data URI
  // (`data:image/jpeg;base64,…`, ≤200KB after client-side resize) or NULL.
  // Plain TEXT at DB level; the data-URI shape + size cap are enforced at
  // the API boundary (images/validation.ts). No EXIF survives: the client
  // re-encodes through canvas before upload.
  avatarData: text('avatar_data'),
  role: userRole('role').notNull().default('buyer'),
  status: userStatus('status').notNull().default('active'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
