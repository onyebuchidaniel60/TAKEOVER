// Follow graph (Phase 5k-C).
//
// Cosmetic by owner decision D19: a follow has NO feed effect, NO
// notification, and there are no private accounts. This table is the whole
// feature — the endpoints read and write rows, and nothing else in the
// product consults it yet.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The account doing the following.
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The account being followed.
    followingId: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One edge per direction. The UNIQUE constraint is what makes the
    // endpoint idempotent under a double-tap, not application code.
    followerFollowingUnique: uniqueIndex('follows_follower_following_unique').on(
      table.followerId,
      table.followingId,
    ),
    // Reverse lookups ("who follows this user") and "what does this user
    // follow" each need their own access path; without these both are
    // sequential scans of the whole edge table.
    followingIdx: index('follows_following_idx').on(table.followingId),
    // DB-level backstop for self-follow. The API already answers 409, but
    // an invariant that lives only in the handler is one code path away from
    // being wrong.
    noSelfFollow: check('follows_no_self_follow', sql`${table.followerId} <> ${table.followingId}`),
  }),
);

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
