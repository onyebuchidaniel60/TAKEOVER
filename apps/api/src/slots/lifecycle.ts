// Phase 5: provider slot lifecycle service. Server is authoritative: every
// mutation loads the slot, enforces owner + state, and writes atomically.
// State-changing updates use conditional WHERE clauses so concurrent
// transitions fail closed instead of silently overwriting each other.
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, slots } from '../../../../db/schema';
import { AppError } from '../http/errors';
import { toOwnerSlot, type OwnerSlot } from './owner-slot';
import { serializePriceNim } from './price';
import {
  canonicalizePayoutWallet,
  requireCancellableStatus,
  requireDraftForEdit,
  requireDraftForPublish,
  validatePublishable,
  type SlotCreateInput,
  type SlotPatchInput,
} from './validation';

type Db = ReturnType<typeof getDb>;
type SlotRow = typeof slots.$inferSelect;

// Claims in these states mean money may already be moving: cancellation is
// blocked and the provider cannot strand or double-spend that demand.
const BLOCKING_CLAIM_STATUSES = ['payment_pending', 'paid', 'payment_review'] as const;

/** Load an owned slot or throw 404 (never reveal other owners' slots). */
export async function getOwnSlot(db: Db, ownerId: string, slotId: string): Promise<SlotRow> {
  const rows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
  }
  return row;
}

export async function createSlot(
  db: Db,
  ownerId: string,
  input: SlotCreateInput,
): Promise<OwnerSlot> {
  const rows = await db
    .insert(slots)
    .values({
      providerId: ownerId,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      locationLabel: input.location_label ?? null,
      startsAt: new Date(input.starts_at),
      endsAt: input.ends_at ? new Date(input.ends_at) : null,
      priceNim: BigInt(serializePriceNim(input.price_nim)),
      totalQuantity: input.total_quantity,
      availableQuantity: input.total_quantity,
      payoutWallet: canonicalizePayoutWallet(input.payout_wallet),
      status: 'draft',
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return toOwnerSlot(row);
}

export async function updateDraftSlot(
  db: Db,
  ownerId: string,
  slotId: string,
  patch: SlotPatchInput,
): Promise<OwnerSlot> {
  const current = await getOwnSlot(db, ownerId, slotId);
  requireDraftForEdit(current.status);
  const values: Partial<typeof slots.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description ?? null;
  if (patch.category !== undefined) values.category = patch.category ?? null;
  if (patch.location_label !== undefined) values.locationLabel = patch.location_label ?? null;
  if (patch.starts_at !== undefined) values.startsAt = new Date(patch.starts_at);
  if (patch.ends_at !== undefined) values.endsAt = patch.ends_at ? new Date(patch.ends_at) : null;
  if (patch.price_nim !== undefined) values.priceNim = BigInt(serializePriceNim(patch.price_nim));
  if (patch.total_quantity !== undefined) {
    // Drafts hold no demand, so the full quantity stays available.
    values.totalQuantity = patch.total_quantity;
    values.availableQuantity = patch.total_quantity;
  }
  if (patch.payout_wallet !== undefined) {
    values.payoutWallet = canonicalizePayoutWallet(patch.payout_wallet);
  }
  // Conditional write: a concurrent publish/cancel wins instead of being clobbered.
  const rows = await db
    .update(slots)
    .set(values)
    .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId), eq(slots.status, 'draft')))
    .returning();
  const row = rows[0];
  if (!row) {
    throw new AppError(409, 'SLOT_NOT_EDITABLE', 'Only draft slots can be edited.');
  }
  return toOwnerSlot(row);
}

export async function publishSlot(db: Db, ownerId: string, slotId: string): Promise<OwnerSlot> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    requireDraftForPublish(current.status);
    const now = new Date();
    const failed = validatePublishable(
      {
        title: current.title,
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        priceNim: current.priceNim,
        totalQuantity: current.totalQuantity,
        payoutWallet: current.payoutWallet,
      },
      now,
    );
    if (failed.length > 0) {
      throw new AppError(400, 'INVALID_INPUT', `Cannot publish: invalid ${failed.join(', ')}.`);
    }
    const updated = await tx
      .update(slots)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(and(eq(slots.id, slotId), eq(slots.status, 'draft')))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new AppError(409, 'SLOT_NOT_PUBLISHABLE', 'Only draft slots can be published.');
    }
    return toOwnerSlot(row);
  });
}

export async function cancelSlot(db: Db, ownerId: string, slotId: string): Promise<OwnerSlot> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    requireCancellableStatus(current.status);
    const blocking = await tx
      .select({ id: claims.id })
      .from(claims)
      .where(
        and(eq(claims.slotId, slotId), inArray(claims.status, [...BLOCKING_CLAIM_STATUSES])),
      )
      .limit(1);
    if (blocking.length > 0) {
      throw new AppError(
        409,
        'SLOT_NOT_CANCELLABLE',
        'This slot has claims awaiting or confirming payment and cannot be cancelled.',
      );
    }
    const now = new Date();
    // Release soft holds; paid/verified demand would have blocked above.
    await tx
      .update(claims)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(claims.slotId, slotId), eq(claims.status, 'active_hold')));
    const updated = await tx
      .update(slots)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(slots.id, slotId),
          inArray(slots.status, ['draft', 'published'] as const),
        ),
      )
      .returning();
    const row = updated[0];
    if (!row) {
      throw new AppError(409, 'SLOT_NOT_CANCELLABLE', 'This slot can no longer be cancelled.');
    }
    return toOwnerSlot(row);
  });
}

export interface ListOwnSlotsOptions {
  status?: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired';
  limit: number;
  offset: number;
}

export async function listOwnSlots(
  db: Db,
  ownerId: string,
  options: ListOwnSlotsOptions,
): Promise<{ slots: OwnerSlot[]; total: number }> {
  const where =
    options.status === undefined
      ? and(eq(slots.providerId, ownerId))
      : and(eq(slots.providerId, ownerId), eq(slots.status, options.status));
  const rows = await db
    .select()
    .from(slots)
    .where(where)
    .orderBy(desc(slots.createdAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(slots).where(where);
  return { slots: rows.map(toOwnerSlot), total: totalRows[0]?.value ?? 0 };
}
