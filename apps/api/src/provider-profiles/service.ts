// Phase 9: provider display-name profiles. One row per user at most
// (user_id UNIQUE); only display_name is editable — verified stays
// server/admin-controlled and is never written here. No new columns.
import { getDb } from '../../../../db/client';
import { providerProfiles } from '../../../../db/schema';
import { AppError } from '../http/errors';

type Db = ReturnType<typeof getDb>;

export interface ProviderProfileView {
  displayName: string;
}

/** Upsert by user: create the row when absent, rename it when present. */
export async function upsertProviderProfile(
  db: Db,
  options: { userId: string; displayName: string },
): Promise<ProviderProfileView> {
  const now = new Date();
  const rows = await db
    .insert(providerProfiles)
    .values({ userId: options.userId, displayName: options.displayName })
    .onConflictDoUpdate({
      target: providerProfiles.userId,
      set: { displayName: options.displayName, updatedAt: now },
    })
    .returning({ displayName: providerProfiles.displayName });
  const row = rows[0];
  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return { displayName: row.displayName };
}
