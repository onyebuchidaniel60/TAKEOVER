// Public profile read model (Phase 5k-B).
//
// STRICTLY PUBLIC. This projection is reachable without authentication at
// GET /api/v1/users/:username, so it is allow-listed field by field — never
// built by spreading a users row. email, phone, dob, password_hash,
// wallet_address and role are all deliberately absent: a future column added
// to the users table must be opted in here, not leak by default.
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, providerProfiles, slots, users } from '../../../../db/schema';
import { getFollowCounts, isFollowing } from '../follows/service';
import { AppError } from '../http/errors';
import { resolveProviderDisplay } from '../slots/provider-display';

type Db = ReturnType<typeof getDb>;

/** The only shape a public profile ever takes. */
export interface PublicProfile {
  username: string;
  /** provider_profiles.display_name, else `@username`. Never the wallet. */
  displayName: string;
  avatarData: string | null;
  bio: string | null;
  location: string | null;
  /** ISO date (YYYY-MM-DD) of users.created_at. */
  memberSince: string;
  /**
   * Does the REQUESTING user follow this profile? null for a guest or when
   * the viewer is the profile owner. Resolved in the same round trip so the
   * Follow button does not need a second request to render its state.
   */
  isFollowing: boolean | null;
  stats: {
    /** Published openings this user offers. */
    openings: number;
    /** Claims this user has made as a buyer. */
    claims: number;
    /**
     * Real counts from the follows table (Phase 5k-C).
     */
    followers: number;
    following: number;
  };
}

/** users.created_at as YYYY-MM-DD. */
function toMemberSince(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 10);
}

/**
 * Resolve a public profile by username.
 *
 * Usernames are stored lowercased and unique, so this is an exact match on
 * the normalized input — never a case-insensitive or prefix scan, which
 * would let a caller enumerate handles.
 *
 * Disabled accounts and unknown handles both return 404 so a public caller
 * cannot distinguish "exists but disabled" from "does not exist".
 */
export async function getPublicProfile(
  db: Db,
  rawUsername: string,
  viewerId: string | null = null,
): Promise<PublicProfile> {
  const username = rawUsername.trim().toLowerCase();
  if (username === '') {
    throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
  }

  // One joined read: the identity columns plus the optional provider
  // display name that lives on a separate row.
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      walletAddress: users.walletAddress,
      bio: users.bio,
      location: users.location,
      avatarData: users.avatarData,
      createdAt: users.createdAt,
      displayName: providerProfiles.displayName,
    })
    .from(users)
    .leftJoin(providerProfiles, eq(providerProfiles.userId, users.id))
    .where(and(eq(users.username, username), eq(users.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (!row?.username) {
    throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
  }

  // Three cheap aggregate reads: published openings, buyer claims, and the
  // follow graph in both directions. A refunded/expired claim still
  // happened, so every claim status counts.
  const [openingRows, claimRows, followCounts, viewerFollows] = await Promise.all([
    db
      .select({ value: count() })
      .from(slots)
      .where(and(eq(slots.providerId, row.id), eq(slots.status, 'published'))),
    db.select({ value: count() }).from(claims).where(eq(claims.buyerId, row.id)),
    getFollowCounts(db, row.id),
    // A guest, or the owner viewing their own profile, gets null rather
    // than a misleading false.
    viewerId && viewerId !== row.id ? isFollowing(db, viewerId, row.id) : Promise.resolve(null),
  ]);

  return {
    username: row.username,
    displayName: resolveProviderDisplay(row.displayName, row.walletAddress, `@${row.username}`),
    avatarData: row.avatarData,
    bio: row.bio,
    location: row.location,
    memberSince: toMemberSince(row.createdAt),
    isFollowing: viewerFollows,
    stats: {
      openings: Number(openingRows[0]?.value ?? 0),
      claims: Number(claimRows[0]?.value ?? 0),
      followers: followCounts.followers,
      following: followCounts.following,
    },
  };
}
