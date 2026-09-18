// Phase 5: provider slot lifecycle service. Server is authoritative: every
// mutation loads the slot, enforces owner + state, and writes atomically.
// State-changing updates use conditional WHERE clauses so concurrent
// transitions fail closed instead of silently overwriting each other.
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, slots } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { isUniqueViolation } from '../claims/service';
import { getListingFeeState } from '../env';
import { AppError } from '../http/errors';
import {
  assessListingFee,
  expectedFeeDataForSlot,
  listingFeeErrorLine,
  normalizeFeeHash,
} from '../listing-fee/verify';
import { nimToBaseUnits } from '../payments/amounts';
import {
  createRpcClient,
  getNimiqRpcUrl,
  RpcUnavailableError,
  type NimiqRpcClient,
} from '../payments/rpc';
import { toOwnerSlot, type OwnerSlot } from './owner-slot';
import { loadProviderDisplay, loadProviderDisplayMap } from './provider-display';
import { serializePriceUsdt } from './price';
import {
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
      priceUsdt: BigInt(serializePriceUsdt(input.price_usdt)),
      totalQuantity: input.total_quantity,
      availableQuantity: input.total_quantity,
      status: 'draft',
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
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
  if (patch.price_usdt !== undefined) values.priceUsdt = BigInt(serializePriceUsdt(patch.price_usdt));
  if (patch.total_quantity !== undefined) {
    // Drafts hold no demand, so the full quantity stays available.
    values.totalQuantity = patch.total_quantity;
    values.availableQuantity = patch.total_quantity;
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
  return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
}

/**
 * Phase 14d-4: set or clear the provider contact note. The write gate is
 * deliberately open — any status the caller owns — the restriction lives on
 * the buyer read gate (claim/escrow views). The row lock serializes
 * concurrent PATCHes so a same-value re-set is a true no-op (no write, no
 * audit). The audit carries IDs and lengths only, never the note text.
 * Input arrives API-validated (trimmed, 1–500 chars, no URLs); the service
 * trusts the boundary per the lifecycle-layer convention.
 */
export async function updateSlotContactNote(
  db: Db,
  ownerId: string,
  slotId: string,
  note: string | null,
  audit?: { requestId?: string | null },
): Promise<OwnerSlot> {
  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
      .for('update')
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    if (current.providerContactNote === note) {
      return current;
    }
    const now = new Date();
    const updated = await tx
      .update(slots)
      .set({ providerContactNote: note, updatedAt: now })
      .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: ownerId,
      eventType: 'slot.contact_note_updated',
      entityType: 'slot',
      entityId: next.id,
      requestId: audit?.requestId ?? null,
      metadata: {
        slotId: next.id,
        hadNote: current.providerContactNote !== null,
        noteLength: note === null ? 0 : note.length,
      },
    });
    return next;
  });
  return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
}

export interface PublishFeeOptions {
  /** Client-supplied fee tx hash (fee path only; ignored when no fee is configured). */
  transactionHash?: string;
  /** Injected chain reader (tests). Defaults to the Nimiq RPC client. */
  rpc?: NimiqRpcClient;
}

export async function publishSlot(
  db: Db,
  ownerId: string,
  slotId: string,
  audit?: { requestId?: string | null },
  fee?: PublishFeeOptions,
): Promise<OwnerSlot> {
  const feeState = getListingFeeState();
  if (!feeState.required) {
    return publishSlotUnpaid(db, ownerId, slotId, audit);
  }
  // F4 fail-closed: a half-configured fee never degrades to "no fee".
  if (feeState.misconfigured || feeState.walletAddress === null || feeState.amountNim === null) {
    throw new AppError(503, 'INTERNAL_ERROR', 'Listing fee is misconfigured. Contact support.');
  }
  const hash = normalizeFeeHash(fee?.transactionHash);
  if (hash === null) {
    throw new AppError(
      400,
      'PAYMENT_INVALID_TX',
      `Publishing requires a ${feeState.amountNim} NIM listing fee. Send the fee, then retry with its transaction hash.`,
    );
  }
  return publishSlotWithFee(db, ownerId, slotId, audit, {
    feeAmountNim: feeState.amountNim,
    feeWallet: feeState.walletAddress,
    hash,
    rpc: fee?.rpc,
  });
}

async function publishSlotUnpaid(
  db: Db,
  ownerId: string,
  slotId: string,
  audit?: { requestId?: string | null },
): Promise<OwnerSlot> {
  const row = await db.transaction(async (tx) => {
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
        priceUsdt: current.priceUsdt,
        totalQuantity: current.totalQuantity,
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
    await writeAuditEvent(tx, {
      actorUserId: ownerId,
      eventType: 'slot.published',
      entityType: 'slot',
      entityId: row.id,
      requestId: audit?.requestId ?? null,
      metadata: { from: 'draft', to: 'published' },
    });
    return row;
  });
  return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
}

/**
 * Phase 14g-1: fee-gated publish. Verifies the seller's on-chain NIM fee
 * transfer before flipping draft → published. Stateless across attempts:
 * nothing is stored until verification succeeds, so a failed attempt leaves
 * the slot draft and the client retries with the same hash (D6); the
 * listing_fee_tx_hash UNIQUE constraint is the replay backstop.
 *
 * A fee payment is valid when recipient, exact Luna amount, slot-bound
 * data, and confirmations all check out. The sender is intentionally NOT
 * compared (the data binding ties the payment to the slot and the slot
 * owner is authenticated at publish time).
 *
 * Error mapping (ARCH §15 only): missing/malformed hash → 400
 * PAYMENT_INVALID_TX; unknown hash → 409 PAYMENT_NOT_FOUND; under-confirmed
 * → 409 PAYMENT_NOT_CONFIRMED; recipient/amount/data mismatches → the
 * matching 409 code; reused hash → 409 PAYMENT_REPLAY; RPC failure → 503
 * RPC_UNAVAILABLE. Every non-verified outcome also emits one
 * [listing-fee-error] diagnostic line (public chain data only).
 */
async function publishSlotWithFee(
  db: Db,
  ownerId: string,
  slotId: string,
  audit: { requestId?: string | null } | undefined,
  fee: { feeAmountNim: string; feeWallet: string; hash: string; rpc?: NimiqRpcClient },
): Promise<OwnerSlot> {
  // Fail fast on slot state BEFORE any chain lookup: ownership, draft, and
  // publishability are checked first. The one exception is the idempotent
  // re-POST: an already-published slot carrying this exact fee hash returns
  // its state (same transfer, same slot, exactly once).
  const preRows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
    .limit(1);
  const pre = preRows[0];
  if (!pre) {
    throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
  }
  if (pre.status === 'published' && pre.listingFeeTxHash === fee.hash) {
    return toOwnerSlot(pre, await loadProviderDisplay(db, pre.providerId));
  }
  requireDraftForPublish(pre.status);
  const now = new Date();
  const failed = validatePublishable(
    {
      title: pre.title,
      startsAt: pre.startsAt,
      endsAt: pre.endsAt,
      priceUsdt: pre.priceUsdt,
      totalQuantity: pre.totalQuantity,
    },
    now,
  );
  if (failed.length > 0) {
    throw new AppError(400, 'INVALID_INPUT', `Cannot publish: invalid ${failed.join(', ')}.`);
  }
  // Replay gate (D4): a fee transfer settles at most one publish. A hash
  // already stored on ANY slot is rejected here — before the data check —
  // so reuse always reports PAYMENT_REPLAY (the UNIQUE constraint below
  // remains the backstop for a check-then-write race).
  const usedRows = await db
    .select({ id: slots.id })
    .from(slots)
    .where(eq(slots.listingFeeTxHash, fee.hash))
    .limit(1);
  if (usedRows.length > 0) {
    throw new AppError(409, 'PAYMENT_REPLAY', 'This fee payment was already used.');
  }

  // Chain lookup happens OUTSIDE any DB transaction — never hold a pooled
  // connection across a 5s network call (same rule as verify-payment).
  const rpc = fee.rpc ?? createRpcClient(getNimiqRpcUrl());
  let found;
  try {
    found = await rpc.getTransactionByHash(fee.hash);
  } catch (err) {
    if (err instanceof RpcUnavailableError) {
      throw new AppError(
        503,
        'RPC_UNAVAILABLE',
        'Listing-fee verification is temporarily unavailable. Please try again.',
      );
    }
    throw err;
  }
  const amountLuna = nimToBaseUnits(fee.feeAmountNim);
  const expectedData = expectedFeeDataForSlot(slotId);
  const assessment = assessListingFee(found, {
    recipient: fee.feeWallet,
    amountLuna,
    data: expectedData,
  });
  if (assessment.status !== 'verified') {
    // Diagnostic telemetry for every failed fee verification (marker is
    // grep-friendly; all fields are public chain data or public IDs —
    // never secrets, sessions, or request bodies). The fd-2 error stream
    // is the sink here (same standing note as the escrow polygon client:
    // Fastify's logger is unreachable from this layer).
    console.error(
      listingFeeErrorLine({
        slotId,
        txHash: fee.hash,
        reason: assessment.reason ?? 'verified',
        confirmations: assessment.confirmations,
        expectedRecipient: fee.feeWallet,
        actualRecipient: found?.recipient ?? null,
        expectedAmount: amountLuna,
        actualAmount: found?.value ?? null,
        expectedData,
        actualData: found?.data ?? null,
      }),
    );
  }
  if (assessment.status === 'pending') {
    if (assessment.reason === 'not-found') {
      throw new AppError(
        409,
        'PAYMENT_NOT_FOUND',
        'Fee payment not found on-chain yet. Please try again.',
      );
    }
    const n = assessment.confirmations ?? 0;
    throw new AppError(
      409,
      'PAYMENT_NOT_CONFIRMED',
      `Fee payment needs 3 confirmations (${n} so far). Please try again.`,
    );
  }
  if (assessment.status === 'review') {
    switch (assessment.reason) {
      case 'recipient_mismatch':
        throw new AppError(
          409,
          'PAYMENT_RECIPIENT_MISMATCH',
          'Fee payment went to the wrong address. Pay to the address shown on this page. Fee transfers are final.',
        );
      case 'amount_mismatch':
        throw new AppError(
          409,
          'PAYMENT_AMOUNT_MISMATCH',
          `Fee payment must be exactly ${fee.feeAmountNim} NIM. Fee transfers are final.`,
        );
      default:
        throw new AppError(
          409,
          'PAYMENT_DATA_MISMATCH',
          'Fee payment does not match this opening. Fee transfers are final.',
        );
    }
  }

  // Verified: single conditional-write transaction records the receipt and
  // flips the slot. A UNIQUE hit on the fee hash means the transfer already
  // settled another publish → replay.
  try {
    const row = await db.transaction(async (tx) => {
      const updated = await tx
        .update(slots)
        .set({
          status: 'published',
          listingFeeTxHash: fee.hash,
          listingFeePaidAt: now,
          publishedAt: now,
          updatedAt: now,
        })
        .where(and(eq(slots.id, slotId), eq(slots.status, 'draft')))
        .returning();
      const row = updated[0];
      if (!row) {
        // Lost a race: re-read the winner. Same hash on this slot is the
        // idempotent success; anything else is no longer publishable.
        const winner = await tx
          .select()
          .from(slots)
          .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
          .limit(1);
        const current = winner[0];
        if (current && current.status === 'published' && current.listingFeeTxHash === fee.hash) {
          return current;
        }
        throw new AppError(409, 'SLOT_NOT_PUBLISHABLE', 'Only draft slots can be published.');
      }
      await writeAuditEvent(tx, {
        actorUserId: ownerId,
        eventType: 'slot.published',
        entityType: 'slot',
        entityId: row.id,
        requestId: audit?.requestId ?? null,
        metadata: { from: 'draft', to: 'published', feeTxHash: fee.hash },
      });
      return row;
    });
    return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'PAYMENT_REPLAY', 'This fee payment was already used.');
    }
    throw err;
  }
}

export async function cancelSlot(
  db: Db,
  ownerId: string,
  slotId: string,
  audit?: { requestId?: string | null },
): Promise<OwnerSlot> {
  const row = await db.transaction(async (tx) => {
    // Row lock (Phase 13 race fix): without it a concurrent claim can commit
    // between the hold-release UPDATE below and the slot-cancel UPDATE,
    // leaving live holds on a cancelled slot. createClaim and admin
    // disableSlot already lock the same way; same lock order (slot first),
    // so no deadlock cycle is introduced.
    const rows = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.providerId, ownerId)))
      .for('update')
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
    const priorStatus = current.status;
    // Release soft holds; paid/verified demand would have blocked above.
    const released = await tx
      .update(claims)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(claims.slotId, slotId), eq(claims.status, 'active_hold')))
      .returning({ id: claims.id });
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
    await writeAuditEvent(tx, {
      actorUserId: ownerId,
      eventType: 'slot.cancelled',
      entityType: 'slot',
      entityId: row.id,
      requestId: audit?.requestId ?? null,
      metadata: { from: priorStatus, to: 'cancelled', releasedHolds: released.length },
    });
    return row;
  });
  return toOwnerSlot(row, await loadProviderDisplay(db, row.providerId));
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
  const displays = await loadProviderDisplayMap(
    db,
    rows.map((row) => row.providerId),
  );
  const items = rows.map((row) => {
    const display = displays.get(row.providerId);
    if (display === undefined) {
      // Unreachable in practice: slots.provider_id references users.id.
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return toOwnerSlot(row, display);
  });
  return { slots: items, total: totalRows[0]?.value ?? 0 };
}
