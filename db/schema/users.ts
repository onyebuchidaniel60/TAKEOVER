import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userRole, userStatus } from './enums';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Nullable since Phase 5g (dual identity): email/password users have no
  // wallet until they link one. UNIQUE-when-present: Postgres treats NULLs
  // as distinct, so multiple wallet-less rows coexist.
  walletAddress: text('wallet_address').unique(),
  // Email identity (Phase 5g). Stored lowercased; NULL for wallet-only and
  // Google-only users. Unverified field under option B (no email service):
  // emailVerifiedAt is reserved so a future verification flow needs no
  // new migration.
  email: text('email').unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // scrypt PHC string (apps/api/src/auth/password.ts). NULL for
  // wallet-only and Google-only users.
  passwordHash: text('password_hash'),
  // Google `sub` claim (reserved for Phase 5h). NULL until then.
  googleSub: text('google_sub').unique(),
  // Unique handle (Phase 5g). Stored lowercased, immutable after set.
  username: text('username').unique(),
  // Plain-text profile fields. Bio is ~160 chars, no URLs (API-validated
  // in a later phase). Phone/DOB are optional and private (stored, never
  // served on public projections).
  bio: text('bio'),
  phone: text('phone'),
  dob: date('dob'),
  location: text('location'),
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
