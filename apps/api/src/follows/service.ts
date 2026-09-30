// Follow graph read/write (Phase 5k-C).
//
// Owner decision D19: follow is COSMETIC. No feed effect, no notification,
// no private accounts. Nothing outside this module and the endpoints
// consults these rows yet — keep it that way unless a later phase says so.
//
// Idempotency is enforced by the DB, not by a read-then-write in the
// handler: the UNIQUE(follower_id, following_id) constraint makes a double
// tap a no-op, and onConflictDoNothing absorbs the race. The alternative
// (SELECT then INSERT) has a window where two concurrent taps both insert.
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { follows, providerProfiles, users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';
import { resolveProviderDisplay } from '../slots/provider-display';

type Db = ReturnType<typeof getDb>;

/** Resolve a handle to an active user id, or null. */
export async function findUserIdByUsername(db: Db, rawUsername: string): Promise<string | null> {
  const username = rawUsername.trim().toLowerCase();
  if (username === '') return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, 'active')))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Follow. Idempotent: an existing edge is a 200 no-op, not an error, so a
 * retried request cannot tell the user their follow failed.
 * Self-follow is rejected at the API boundary (409) and again by the CHECK
 * constraint, so neither layer is the only thing standing between.
 *
 * The edge write and its audit row share one transaction (audit/events.ts
 * rule: they succeed or fail together). Metadata carries the two user IDs
 * and nothing else — no handle, no email, no wallet.
 */
export async function followUser(
  db: Db,
  followerId: string,
  followingId: string,
  requestId: string,
): Promise<{ following: boolean }> {
  if (followerId === followingId) {
    throw new AppError(409, 'CANNOT_FOLLOW_SELF', 'You cannot follow yourself.');
  }
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(follows)
      .values({ followerId, followingId })
      .onConflictDoNothing()
      .returning({ id: follows.id });
    // No new row = the edge already existed, so this was a retry. Writing an
    // audit event for a no-op would make the log lie about what happened.
    if (inserted.length === 0) return;
    await writeAuditEvent(tx, {
      actorUserId: followerId,
      eventType: 'user.followed',
      entityType: 'follow',
      entityId: followingId,
      requestId,
      metadata: { followerId, followingId },
    });
  });
  return { following: true };
}

/** Unfollow. Idempotent: no edge is a 200 no-op, and writes no audit row. */
export async function unfollowUser(
  db: Db,
  followerId: string,
  followingId: string,
  requestId: string,
): Promise<{ following: boolean }> {
  if (followerId === followingId) {
    throw new AppError(409, 'CANNOT_FOLLOW_SELF', 'You cannot follow yourself.');
  }
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
      .returning({ id: follows.id });
    if (removed.length === 0) return;
    await writeAuditEvent(tx, {
      actorUserId: followerId,
      eventType: 'user.unfollowed',
      entityType: 'follow',
      entityId: followingId,
      requestId,
      metadata: { followerId, followingId },
    });
  });
  return { following: false };
}

/** Counts for the public profile stats row. Two cheap aggregates. */
export async function getFollowCounts(
  db: Db,
  userId: string,
): Promise<{ followers: number; following: number }> {
  const [followerRows, followingRows] = await Promise.all([
    db.select({ value: count() }).from(follows).where(eq(follows.followingId, userId)),
    db.select({ value: count() }).from(follows).where(eq(follows.followerId, userId)),
  ]);
  return {
    followers: Number(followerRows[0]?.value ?? 0),
    following: Number(followingRows[0]?.value ?? 0),
  };
}

/** Does `viewerId` follow `userId`? false when the viewer is a guest. */
export async function isFollowing(db: Db, viewerId: string | null, userId: string): Promise<boolean> {
  if (!viewerId) return false;
  const rows = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** One row in a followers/following list. Public fields only. */
export interface FollowListEntry {
  username: string;
  displayName: string;
  avatarData: string | null;
  /** Null for a guest viewer; otherwise whether the viewer follows them. */
  isFollowing: boolean | null;
}

const LIST_LIMIT = 50;

/**
 * List the users following `userId`, or the users `userId` follows
 * (direction = 'followers' | 'following'), newest edge first.
 *
 * Accounts with no handle (pre-5g wallet-only rows) are skipped: a list
 * entry must be addressable, and there is no /u/: route for them.
 * `isFollowing` is computed for the requesting user only, so a guest costs
 * no extra query.
 */
export async function listFollows(
  db: Db,
  userId: string,
  direction: 'followers' | 'following',
  viewerId: string | null,
): Promise<FollowListEntry[]> {
  // Two distinct columns, which is the whole point of the two directions:
  //   followers -> the PERSON is follows.followerId, the target is followingId
  //   following -> the PERSON is follows.followingId, the target is followerId
  // Using one column for both the join and the filter silently turns
  // "followers" into "who they follow", so they are named separately.
  const personColumn = direction === 'followers' ? follows.followerId : follows.followingId;
  const targetColumn = direction === 'followers' ? follows.followingId : follows.followerId;
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      walletAddress: users.walletAddress,
      avatarData: users.avatarData,
      displayName: providerProfiles.displayName,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, personColumn))
    .leftJoin(providerProfiles, eq(providerProfiles.userId, users.id))
    .where(and(eq(targetColumn, userId), isNotNull(users.username)))
    .orderBy(desc(follows.createdAt))
    .limit(LIST_LIMIT);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.userId);
  let viewerFollowing: Set<string> = new Set();
  if (viewerId) {
    const viewerEdges = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(and(eq(follows.followerId, viewerId), inArray(follows.followingId, ids)));
    viewerFollowing = new Set(viewerEdges.map((edge) => edge.followingId));
  }

  return rows.map((row) => ({
    username: row.username as string,
    displayName: resolveProviderDisplay(row.displayName, row.walletAddress, `@${row.username}`),
    avatarData: row.avatarData,
    isFollowing: viewerId ? viewerFollowing.has(row.userId) : null,
  }));
}
