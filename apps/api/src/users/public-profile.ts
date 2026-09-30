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
  stats: {
    /** Published openings this user offers. */
    openings: number;
    /** Claims this user has made as a buyer. */
    claims: number;
    /**
     * Phase 5k-C replaces these with real counts from the follows table.
     * They are reported as 0 (not omitted) so the response shape does not
     * change when the counts go live, and the Part-B UI does not read them.
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
export async function getPublicProfile(db: Db, rawUsername: string): Promise<PublicProfile> {
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

  // Two cheap aggregate reads. Published openings and all buyer claims; a
  // refunded/expired claim still happened, so every status counts as a claim.
  const [openingRows, claimRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(slots)
      .where(and(eq(slots.providerId, row.id), eq(slots.status, 'published'))),
    db.select({ value: count() }).from(claims).where(eq(claims.buyerId, row.id)),
  ]);

  return {
    username: row.username,
    displayName: resolveProviderDisplay(row.displayName, row.walletAddress, `@${row.username}`),
    avatarData: row.avatarData,
    bio: row.bio,
    location: row.location,
    memberSince: toMemberSince(row.createdAt),
    stats: {
      openings: Number(openingRows[0]?.value ?? 0),
      claims: Number(claimRows[0]?.value ?? 0),
      followers: 0,
      following: 0,
    },
  };
}
