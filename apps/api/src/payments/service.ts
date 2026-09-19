// Payment intent + submission service. Recording only — NO chain
// reads, NO verification here. The tx_hash UNIQUE constraint from
// The tx_hash UNIQUE constraint is the replay guard; the DB enforces it, this layer maps it.
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, paymentIntents, slots, users } from '../../../../db/schema';
import { canonicalizeNimiqAddress, InvalidAddressError } from '../auth/nimiq-address';
import { writeAuditEvent } from '../audit/events';
import { isUniqueViolation } from '../claims/service';
import { toClaimView, type ClaimView } from '../claims/claim-view';
import { AppError } from '../http/errors';
import { loadProviderDisplay } from '../slots/provider-display';
import { toPublicSlot, type PublicSlot } from '../slots/public-slot';
import { toPaymentIntentView, type PaymentIntentView } from './intent-view';

type Db = ReturnType<typeof getDb>;

/** Claim states that may carry a payment intent. Anything else → 409. */
const INTENT_PAYABLE_STATUSES = ['active_hold', 'payment_pending'] as const;

/** Exact on-chain binding between a payment and its claim. Stored as-is. */
export function expectedDataForClaim(claimId: string): string {
  return `TAKEOVER:v1:${claimId}`;
}

/** Stored payout/sender values are canonical by construction; a failure here means corrupt server data. */
function canonicalizeOr500(value: string): string {
  try {
    return canonicalizeNimiqAddress(value);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    throw err;
  }
}

export async function createPaymentIntent(
  db: Db,
  options: { claimId: string; buyerId: string },
): Promise<{ intent: PaymentIntentView; claim: ClaimView; slot: PublicSlot }> {
  const decided = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'NOT_FOUND', 'Claim not found.');
    }
    if (
      claim.status !== INTENT_PAYABLE_STATUSES[0] &&
      claim.status !== INTENT_PAYABLE_STATUSES[1]
    ) {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be paid right now.');
    }
    const existing = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, claim.id))
      .limit(1);
    if (existing[0]) {
      const slotRows = await tx.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
      const slot = slotRows[0];
      if (!slot) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
      }
      return { intentRow: existing[0], claimRow: claim, slotRow: slot };
    }
    const slotRows = await tx.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
    const slot = slotRows[0];
    if (!slot) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const buyerRows = await tx.select().from(users).where(eq(users.id, options.buyerId)).limit(1);
    const buyer = buyerRows[0];
    if (!buyer) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const values = {
      claimId: claim.id,
      expectedAmountNim: slot.priceUsdt,
      // Deprecated direct-payment path only (kept for historical rows): new
      // slots carry no payout wallet, so this fails closed (500) there —
      // the live escrow flow never reads slots.payout_wallet.
      expectedRecipient: canonicalizeOr500(slot.payoutWallet ?? ''),
      expectedSender: canonicalizeOr500(buyer.walletAddress),
      expectedData: expectedDataForClaim(claim.id),
      status: 'created' as const,
    };
    let inserted;
    try {
      inserted = await tx.insert(paymentIntents).values(values).returning();
    } catch (err) {
      // Lost a same-claim race: return the winner's intent (idempotent).
      if (isUniqueViolation(err)) {
        const winner = await tx
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.claimId, claim.id))
          .limit(1);
        if (winner[0]) {
          return { intentRow: winner[0], claimRow: claim, slotRow: slot };
        }
      }
      throw err;
    }
    const intent = inserted[0];
    if (!intent) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return { intentRow: intent, claimRow: claim, slotRow: slot };
  });
  return {
    intent: toPaymentIntentView(decided.intentRow),
    claim: toClaimView(decided.claimRow),
    slot: toPublicSlot(
      decided.slotRow,
      await loadProviderDisplay(db, decided.slotRow.providerId),
    ),
  };
}

export async function submitPayment(
  db: Db,
  options: { claimId: string; buyerId: string; txHash: string; now?: Date; requestId?: string | null },
): Promise<{ intent: PaymentIntentView; claim: ClaimView }> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .for('update')
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'NOT_FOUND', 'Claim not found.');
    }
    if (claim.status === 'expired') {
      throw new AppError(409, 'CLAIM_EXPIRED', 'This hold has expired. You can claim again.');
    }
    if (claim.status === 'cancelled') {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be paid right now.');
    }
    if (claim.status === 'paid') {
      throw new AppError(409, 'CLAIM_ALREADY_PAID', 'This claim is already paid.');
    }
    if (
      claim.status !== INTENT_PAYABLE_STATUSES[0] &&
      claim.status !== INTENT_PAYABLE_STATUSES[1]
    ) {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be paid right now.');
    }
    const intentRows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, claim.id))
      .limit(1);
    const intent = intentRows[0];
    if (!intent) {
      throw new AppError(409, 'PAYMENT_INTENT_REQUIRED', 'Create a payment intent first.');
    }
    if (intent.status === 'submitted' || intent.txHash !== null) {
      if (intent.txHash === options.txHash) {
        return { intent: toPaymentIntentView(intent), claim: toClaimView(claim) };
      }
      throw new AppError(
        409,
        'PAYMENT_ALREADY_SUBMITTED',
        'A different transaction was already submitted for this claim.',
      );
    }
    let updated;
    try {
      // Conditional write: created-status rows carry no hash (the two are set
      // together), so this fails closed if a concurrent request moved first.
      // The UNIQUE index on tx_hash is the true cross-claim replay guard.
      updated = await tx
        .update(paymentIntents)
        .set({ txHash: options.txHash, status: 'submitted', submittedAt: now, updatedAt: now })
        .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.status, 'created')))
        .returning();
    } catch (err) {
      // Same hash already attached to a different claim: replay, reject.
      if (isUniqueViolation(err)) {
        throw new AppError(
          409,
          'PAYMENT_ALREADY_SUBMITTED',
          'This transaction was already submitted.',
        );
      }
      throw err;
    }
    const submitted = updated[0];
    if (!submitted) {
      // Lost a race on this intent: re-read and decide idempotent vs conflict.
      const reread = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, intent.id))
        .limit(1);
      if (reread[0]?.txHash === options.txHash) {
        return { intent: toPaymentIntentView(reread[0]), claim: toClaimView(claim) };
      }
      throw new AppError(
        409,
        'PAYMENT_ALREADY_SUBMITTED',
        'A different transaction was already submitted for this claim.',
      );
    }
    let freshClaim = claim;
    if (claim.status === 'active_hold') {
      const moved = await tx
        .update(claims)
        .set({ status: 'payment_pending', updatedAt: now })
        .where(and(eq(claims.id, claim.id), eq(claims.status, 'active_hold')))
        .returning();
      if (moved[0]) {
        freshClaim = moved[0];
      }
    }
    // Fresh submission only: idempotent same-hash re-returns do NOT log.
    await writeAuditEvent(tx, {
      actorUserId: options.buyerId,
      eventType: 'payment.submitted',
      entityType: 'claim',
      entityId: claim.id,
      requestId: options.requestId ?? null,
      metadata: { intentId: submitted.id, from: claim.status, to: freshClaim.status },
    });
    return { intent: toPaymentIntentView(submitted), claim: toClaimView(freshClaim) };
  });
}
