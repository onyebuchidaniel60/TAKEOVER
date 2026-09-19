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
  walletAddress: string,
): string {
  if (typeof displayName === 'string' && displayName.trim() !== '') {
    return displayName;
  }
  return truncateWalletAddress(walletAddress);
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
    .select({ id: users.id, walletAddress: users.walletAddress })
    .from(users)
    .where(inArray(users.id, unique));
  const profileRows = await db
    .select({ userId: providerProfiles.userId, displayName: providerProfiles.displayName })
    .from(providerProfiles)
    .where(inArray(providerProfiles.userId, unique));
  const names = new Map(profileRows.map((row) => [row.userId, row.displayName]));
  const map = new Map<string, string>();
  for (const user of userRows) {
    map.set(user.id, resolveProviderDisplay(names.get(user.id), user.walletAddress));
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
