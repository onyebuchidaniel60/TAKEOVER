// Phase 4: public marketplace read service. Phase 6: sold_out slots stay
// visible (they flip back to published when holds expire). Server is
// authoritative: only slots with status IN ('published', 'sold_out') AND
// starts_at > now() are ever returned. Draft, cancelled, expired, and past
// slots are excluded in SQL — never client-side.
import { and, asc, count, eq, gt, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { slots } from '../../../../db/schema';
import { toPublicSlot, type PublicSlot } from './public-slot';

type Db = ReturnType<typeof getDb>;

export interface SlotListFilters {
  q?: string;
  category?: string;
  location?: string;
  from?: Date;
  to?: Date;
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
  const where = and(...buildPublicSlotConditions(options.filters, now));
  const rows = await db
    .select()
    .from(slots)
    .where(where)
    .orderBy(asc(slots.startsAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(slots).where(where);
  return { slots: rows.map(toPublicSlot), total: totalRows[0]?.value ?? 0 };
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
  return row ? toPublicSlot(row) : null;
}
