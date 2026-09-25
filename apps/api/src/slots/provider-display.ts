// Provider display resolution (display_name preferred, truncated
// wallet fallback). Display-only: truncation never throws, so a corrupt stored
// wallet degrades the label instead of breaking public reads. Lookups are
// batched by provider id to avoid N+1 queries on list endpoints.
import { inArray } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { providerProfiles, users } from '../../../../db/schema';
import { truncateWalletAddress } from '../auth/nimiq-address';
import { AppError } from '../http/errors';

type Db = ReturnType<typeof getDb>;

/** Resolve one display string: profile display_name wins, else truncated wallet. */
export function resolveProviderDisplay(
  displayName: string | null | undefined,
  walletAddress: string | null | undefined,
  fallback?: string | null,
): string {
  if (typeof displayName === 'string' && displayName.trim() !== '') {
    return displayName;
  }
  // Wallet-less users (Phase 5g email identity): show the username handle
  // when the caller passes one, never a crash on null.
  if (typeof walletAddress === 'string' && walletAddress !== '') {
    return truncateWalletAddress(walletAddress);
  }
  if (typeof fallback === 'string' && fallback.trim() !== '') {
    return fallback;
  }
  return 'Someone';
}

export async function loadProviderDisplayMap(
  db: Db,
  providerIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(providerIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const userRows = await db
    .select({ id: users.id, walletAddress: users.walletAddress, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  const profileRows = await db
    .select({ userId: providerProfiles.userId, displayName: providerProfiles.displayName })
    .from(providerProfiles)
    .where(inArray(providerProfiles.userId, unique));
  const names = new Map(profileRows.map((row) => [row.userId, row.displayName]));
  const map = new Map<string, string>();
  for (const user of userRows) {
    map.set(
      user.id,
      resolveProviderDisplay(
        names.get(user.id),
        user.walletAddress,
        user.username ? `@${user.username}` : null,
      ),
    );
  }
  return map;
}

/** Single-provider convenience. Throws 500 when the provider row is missing (FK invariant). */
export async function loadProviderDisplay(db: Db, providerId: string): Promise<string> {
  const map = await loadProviderDisplayMap(db, [providerId]);
  const display = map.get(providerId);
  if (display === undefined) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return display;
}

/** Provider card: display name plus avatar data URI (null when unset). */
export interface ProviderCard {
  display: string;
  avatar: string | null;
}

export async function loadProviderCardMap(db: Db, providerIds: string[]): Promise<Map<string, ProviderCard>> {
  const unique = [...new Set(providerIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const userRows = await db
    .select({
      id: users.id,
      walletAddress: users.walletAddress,
      username: users.username,
      avatarData: users.avatarData,
    })
    .from(users)
    .where(inArray(users.id, unique));
  const profileRows = await db
    .select({ userId: providerProfiles.userId, displayName: providerProfiles.displayName })
    .from(providerProfiles)
    .where(inArray(providerProfiles.userId, unique));
  const names = new Map(profileRows.map((row) => [row.userId, row.displayName]));
  const map = new Map<string, ProviderCard>();
  for (const user of userRows) {
    map.set(user.id, {
      display: resolveProviderDisplay(
        names.get(user.id),
        user.walletAddress,
        user.username ? `@${user.username}` : null,
      ),
      avatar: user.avatarData,
    });
  }
  return map;
}

/** Single-provider card. Throws 500 when the provider row is missing (FK invariant). */
export async function loadProviderCard(db: Db, providerId: string): Promise<ProviderCard> {
  const map = await loadProviderCardMap(db, [providerId]);
  const card = map.get(providerId);
  if (card === undefined) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return card;
}
