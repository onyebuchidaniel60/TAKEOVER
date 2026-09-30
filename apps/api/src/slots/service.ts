// Public marketplace read service. Sold_out slots stay
// visible (they flip back to published when holds expire). Server is
// authoritative: only slots with status IN ('published', 'sold_out') AND
// starts_at > now() are ever returned. Draft, cancelled, expired, and past
// slots are excluded in SQL — never client-side.
import { and, asc, count, eq, gt, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { slots, users } from '../../../../db/schema';
import { AppError } from '../http/errors';
import { loadProviderCard, loadProviderCardMap } from './provider-display';
import { toPublicSlot, type PublicSlot } from './public-slot';

type Db = ReturnType<typeof getDb>;

export interface SlotListFilters {
  q?: string;
  category?: string;
  location?: string;
  from?: Date;
  to?: Date;
  /**
   * Provider handle (Phase 5k-B): restrict the feed to one provider's
   * openings, for the public profile's openings list. A username, not a user
   * id — the id never leaves the server. Resolved to a provider id in
   * listPublicSlots; an unknown handle yields an empty list rather than an
   * error, so a stale link cannot 500 the feed.
   */
  provider?: string;
}

/**
 * Pure future-boundary rule. A slot starting exactly at `now` is NOT future
 * and is excluded. The SQL in `buildPublicSlotConditions` mirrors this with a
 * strict `>` comparison — keep the two in sync.
 */
export function isStartInFuture(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() > now.getTime();
}

/** Escape `%`, `_`, and `\` so user input cannot act as a LIKE wildcard. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build the WHERE conditions for the public list. The two base conditions
 * (claimable status + future start) are always present; each optional filter
 * is a no-op when absent/empty and appended when present.
 */
export function buildPublicSlotConditions(filters: SlotListFilters, now: Date): SQL[] {
  const conditions: SQL[] = [
    inArray(slots.status, ['published', 'sold_out']),
    gt(slots.startsAt, now),
  ];
  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    conditions.push(
      or(
        ilike(slots.title, pattern),
        ilike(slots.description, pattern),
        ilike(slots.locationLabel, pattern),
      ) as SQL,
    );
  }
  const category = filters.category?.trim();
  if (category) {
    conditions.push(eq(slots.category, category));
  }
  const location = filters.location?.trim();
  if (location) {
    conditions.push(ilike(slots.locationLabel, `%${escapeLikePattern(location)}%`));
  }
  if (filters.from) {
    conditions.push(gte(slots.startsAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(slots.startsAt, filters.to));
  }
  return conditions;
}

export interface ListPublicSlotsOptions {
  filters: SlotListFilters;
  limit: number;
  offset: number;
  now?: Date;
}

export async function listPublicSlots(
  db: Db,
  options: ListPublicSlotsOptions,
): Promise<{ slots: PublicSlot[]; total: number }> {
  const now = options.now ?? new Date();
  const conditions = buildPublicSlotConditions(options.filters, now);
  // Provider handle -> provider id, server-side (Phase 5k-B). An unknown
  // handle resolves to an impossible id so the list is empty instead of
  // erroring; a stale /u/:username link must not be able to 500 the feed.
  if (options.filters.provider) {
    const providerRows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, options.filters.provider), eq(users.status, 'active')))
      .limit(1);
    conditions.push(eq(slots.providerId, providerRows[0]?.id ?? '00000000-0000-0000-0000-000000000000'));
  }
  const where = and(...conditions);
  const rows = await db
    .select()
    .from(slots)
    .where(where)
    .orderBy(asc(slots.startsAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(slots).where(where);
  const cards = await loadProviderCardMap(
    db,
    rows.map((row) => row.providerId),
  );
  const items = rows.map((row) => {
    const card = cards.get(row.providerId);
    if (card === undefined) {
      // Unreachable in practice: slots.provider_id references users.id.
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return toPublicSlot(row, card);
  });
  return { slots: items, total: totalRows[0]?.value ?? 0 };
}

/** Claimable (published or sold_out) + future slot by id, or null (caller maps null to 404). */
export async function getPublicSlotById(db: Db, id: string, now?: Date): Promise<PublicSlot | null> {
  const at = now ?? new Date();
  const rows = await db
    .select()
    .from(slots)
    .where(
      and(
        eq(slots.id, id),
        inArray(slots.status, ['published', 'sold_out']),
        gt(slots.startsAt, at),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const card = await loadProviderCard(db, row.providerId);
  return toPublicSlot(row, card);
}
