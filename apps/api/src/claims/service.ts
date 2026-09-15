// Phase 6: atomic claim service. The row lock (SELECT … FOR UPDATE) is what
// serializes concurrent claims — no advisory locks, no external mechanisms.
// Quantity is fixed at 1; the schema supports more, the feature is deferred.
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, slots, users } from '../../../../db/schema';
import { truncateWalletAddress } from '../auth/nimiq-address';
import { getClaimHoldTtlSeconds } from '../env';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';
import { loadProviderDisplay } from '../slots/provider-display';
import { toPublicSlot, type PublicSlot } from '../slots/public-slot';
import { toClaimView, toProviderSlotClaimView, type ClaimView, type ProviderSlotClaimView } from './claim-view';

type Db = ReturnType<typeof getDb>;

/** Claim quantity is fixed at 1 in Phase 6. */
export const CLAIM_QUANTITY = 1;

/** Claim states that count as "live" — mirrors the partial unique index. */
export const LIVE_CLAIM_STATUSES = ['active_hold', 'payment_pending', 'payment_review'] as const;

/** Slot states a buyer may claim from. */
export const CLAIMABLE_SLOT_STATUSES = ['published', 'sold_out'] as const;

/**
 * Pure eligibility mirror of the transaction's checks: claimable status, a
 * future start, and remaining quantity. Unit tested; the SQL path enforces
 * the same rule under a row lock.
 */
export function isClaimEligible(
  slot: { status: string; startsAt: Date; availableQuantity: number },
  now: Date,
): boolean {
  return (
    (slot.status === 'published' || slot.status === 'sold_out') &&
    slot.startsAt.getTime() > now.getTime() &&
    slot.availableQuantity > 0
  );
}

/** Pure hold-expiry predicate: an unexpired or non-hold claim never expires. */
export function isHoldExpired(
  claim: { status: string; holdExpiresAt: Date },
  now: Date,
): boolean {
  return claim.status === 'active_hold' && claim.holdExpiresAt.getTime() < now.getTime();
}

/** Postgres unique-violation code — shared replay-guard detector (Phase 7 reuses it). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

export interface CreateClaimOptions {
  slotId: string;
  buyerId: string;
  now?: Date;
  ttlSeconds?: number;
  requestId?: string | null;
}

/**
 * Atomically claim one unit: lock the slot row, return the buyer's existing
 * live claim if there is one (FR-05 idempotent return — no second claim, no
 * decrement), otherwise re-check eligibility, insert the hold, decrement, and
 * flip to sold_out at 0.
 */
export async function createClaim(
  db: Db,
  options: CreateClaimOptions,
): Promise<{ claim: ClaimView; slot: PublicSlot }> {
  const now = options.now ?? new Date();
  const ttlSeconds = options.ttlSeconds ?? getClaimHoldTtlSeconds();
  const decided = await db.transaction(async (tx) => {
    const locked = await tx.select().from(slots).where(eq(slots.id, options.slotId)).for('update');
    const slot = locked[0];
    if (!slot) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    const liveClaimWhere = and(
      eq(claims.slotId, options.slotId),
      eq(claims.buyerId, options.buyerId),
      inArray(claims.status, [...LIVE_CLAIM_STATUSES]),
    );
    const existing = await tx.select().from(claims).where(liveClaimWhere).limit(1);
    if (existing[0]) {
      return { claimRow: existing[0], slotRow: slot };
    }
    if (!isClaimEligible(slot, now)) {
      throw new AppError(409, 'SLOT_UNAVAILABLE', 'This slot is no longer available.');
    }
    let inserted;
    try {
      inserted = await tx
        .insert(claims)
        .values({
          slotId: options.slotId,
          buyerId: options.buyerId,
          quantity: CLAIM_QUANTITY,
          status: 'active_hold',
          holdExpiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          claimedAt: now,
          updatedAt: now,
        })
        .returning();
    } catch (err) {
      // Second defense behind the live-claim check: the partial unique index.
      // A concurrent same-buyer request won the race — return its claim.
      if (isUniqueViolation(err)) {
        const retry = await tx.select().from(claims).where(liveClaimWhere).limit(1);
        const fresh = await tx.select().from(slots).where(eq(slots.id, options.slotId)).limit(1);
        if (retry[0] && fresh[0]) {
          return { claimRow: retry[0], slotRow: fresh[0] };
        }
      }
      throw err;
    }
    const claim = inserted[0];
    if (!claim) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    // Conditional write on the locked quantity: fails closed if anything moved.
    const newAvailable = slot.availableQuantity - CLAIM_QUANTITY;
    const updated = await tx
      .update(slots)
      .set({
        availableQuantity: newAvailable,
        status: newAvailable <= 0 ? 'sold_out' : slot.status,
        updatedAt: now,
      })
      .where(
        and(eq(slots.id, options.slotId), eq(slots.availableQuantity, slot.availableQuantity)),
      )
      .returning();
    const updatedSlot = updated[0];
    if (!updatedSlot) {
      throw new AppError(409, 'SLOT_UNAVAILABLE', 'This slot is no longer available.');
    }
    // Fresh claim only: idempotent re-returns (existing live claim, or the
    // unique-violation backstop winner) do NOT write audit events.
    await writeAuditEvent(tx, {
      actorUserId: options.buyerId,
      eventType: 'claim.created',
      entityType: 'claim',
      entityId: claim.id,
      requestId: options.requestId ?? null,
      metadata: { slotId: options.slotId, quantity: CLAIM_QUANTITY },
    });
    return { claimRow: claim, slotRow: updatedSlot };
  });
  return {
    claim: toClaimView(decided.claimRow),
    slot: toPublicSlot(
      decided.slotRow,
      await loadProviderDisplay(db, decided.slotRow.providerId),
    ),
  };
}

export interface ExpireHoldsResult {
  expired: number;
  restored: number;
}

/**
 * Idempotent lazy expiry for one slot: flip past-due holds to expired and
 * restore exactly one unit per expired hold, flipping sold_out back to
 * published when quantity returns. The `status = 'active_hold'` predicate is
 * what makes concurrent sweeps safe — a second sweep finds nothing to do.
 */
export async function expireHoldsForSlot(
  db: Db,
  slotId: string,
  now: Date = new Date(),
): Promise<ExpireHoldsResult> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(claims)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(claims.slotId, slotId),
          eq(claims.status, 'active_hold'),
          lt(claims.holdExpiresAt, now),
        ),
      )
      .returning({ id: claims.id });
    if (expired.length === 0) {
      return { expired: 0, restored: 0 };
    }
    // Guarded increment: never exceed total even under pathological data.
    const bumped = await tx
      .update(slots)
      .set({
        availableQuantity: sql`${slots.availableQuantity} + ${expired.length}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(slots.id, slotId),
          sql`${slots.availableQuantity} + ${expired.length} <= ${slots.totalQuantity}`,
        ),
      )
      .returning({ availableQuantity: slots.availableQuantity, status: slots.status });
    if (bumped.length === 0) {
      return { expired: expired.length, restored: 0 };
    }
    if (bumped[0]?.status === 'sold_out' && (bumped[0]?.availableQuantity ?? 0) > 0) {
      await tx
        .update(slots)
        .set({ status: 'published', updatedAt: now })
        .where(eq(slots.id, slotId));
    }
    return { expired: expired.length, restored: expired.length };
  });
}

/** A buyer's own claim plus its slot context, or null (caller maps to 404). */
export async function getClaimForBuyer(
  db: Db,
  claimId: string,
  buyerId: string,
): Promise<{ claim: ClaimView; slot: PublicSlot } | null> {
  const rows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.id, claimId), eq(claims.buyerId, buyerId)))
    .limit(1);
  const claim = rows[0];
  if (!claim) {
    return null;
  }
  const slotRows = await db.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) {
    return null;
  }
  return {
    claim: toClaimView(claim),
    slot: toPublicSlot(slot, await loadProviderDisplay(db, slot.providerId)),
  };
}

export type ClaimStatusValue =
  | 'active_hold'
  | 'expired'
  | 'payment_pending'
  | 'paid'
  | 'payment_review'
  | 'cancelled';

/**
 * Per-status demand counts for one slot. Every key is always present (zeros
 * included) across all 12 live claim_status values — legacy direct-payment
 * states plus the escrow lifecycle. Additive shape: `{ claims, counts }`
 * is unchanged, counts just carries more keys.
 */
export interface SlotClaimCounts {
  active_hold: number;
  expired: number;
  deposit_submitted: number;
  payment_pending: number;
  paid: number;
  payment_review: number;
  cancelled: number;
  escrow_funded: number;
  delivered: number;
  disputed: number;
  released: number;
  refunded: number;
}

const EMPTY_SLOT_CLAIM_COUNTS: SlotClaimCounts = {
  active_hold: 0,
  expired: 0,
  deposit_submitted: 0,
  payment_pending: 0,
  paid: 0,
  payment_review: 0,
  cancelled: 0,
  escrow_funded: 0,
  delivered: 0,
  disputed: 0,
  released: 0,
  refunded: 0,
};

/**
 * Phase 9: every claim on one provider-owned slot, newest first, with
 * truncated buyer identifiers. Non-owned (or missing) slots map to 404 —
 * never 403, never an existence leak. The counts object is computed in the
 * same pass over the same rows as the array, so the two always agree.
 */
export async function listSlotClaimsForProvider(
  db: Db,
  options: { slotId: string; providerId: string },
): Promise<{ claims: ProviderSlotClaimView[]; counts: SlotClaimCounts }> {
  const slotRows = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.id, options.slotId), eq(slots.providerId, options.providerId)))
    .limit(1);
  if (!slotRows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
  }
  const rows = await db
    .select({ claim: claims, buyerWallet: users.walletAddress })
    .from(claims)
    .innerJoin(users, eq(claims.buyerId, users.id))
    .where(eq(claims.slotId, options.slotId))
    .orderBy(desc(claims.claimedAt));
  const views: ProviderSlotClaimView[] = [];
  const counts: SlotClaimCounts = { ...EMPTY_SLOT_CLAIM_COUNTS };
  for (const row of rows) {
    views.push(toProviderSlotClaimView(row.claim, truncateWalletAddress(row.buyerWallet)));
    // Phase 14d-3a: all 12 claim_status values are bucketed (the 14d-1 shim
    // counted six and dropped escrow states — resolved now).
    counts[row.claim.status as keyof SlotClaimCounts] += 1;
  }
  return { claims: views, counts };
}

export interface ListBuyerClaimsOptions {
  status?: ClaimStatusValue;
  limit: number;
  offset: number;
}

export async function listBuyerClaims(
  db: Db,
  buyerId: string,
  options: ListBuyerClaimsOptions,
): Promise<{ claims: ClaimView[]; total: number }> {
  const scoped =
    options.status === undefined
      ? eq(claims.buyerId, buyerId)
      : and(eq(claims.buyerId, buyerId), eq(claims.status, options.status));
  const rows = await db
    .select()
    .from(claims)
    .where(scoped)
    .orderBy(desc(claims.claimedAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(claims).where(scoped);
  return { claims: rows.map(toClaimView), total: totalRows[0]?.value ?? 0 };
}
