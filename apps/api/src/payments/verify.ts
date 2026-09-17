// Phase 8: server-side payment verification against the Nimiq chain. The
// blockchain is authoritative here — client-supplied state stops being
// trusted. Three outcomes: verified (paid), review (human looks, Phase 10),
// pending (tx still propagating or under-confirmed — never rejected here).
// 'rejected' is an admin-only terminal state owned by Phase 10 and is NEVER
// emitted by this module. Inventory is NEVER restored here (not on review,
// not on timeout): the buyer might have paid.
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims, paymentIntents } from '../../../../db/schema';
import { canonicalizeNimiqAddress, InvalidAddressError } from '../auth/nimiq-address';
import { writeAuditEvent } from '../audit/events';
import { getPaymentReviewTimeoutSeconds } from '../env';
import { AppError } from '../http/errors';
import { toClaimView, type ClaimView } from '../claims/claim-view';
import { toPaymentIntentView, type PaymentIntentView } from './intent-view';
import { REQUIRED_CONFIRMATIONS, type NimiqRpcClient, type TxRecord } from './rpc';

type Db = ReturnType<typeof getDb>;

export type VerificationStatus = 'verified' | 'pending' | 'review';

export type VerificationMismatch =
  | 'sender_mismatch'
  | 'recipient_mismatch'
  | 'amount_mismatch'
  | 'data_mismatch'
  | 'hash_mismatch';

/** Client-generic reason codes. Field-level (which check failed), never values. */
export type VerificationReason = VerificationMismatch | 'timeout';

export interface VerificationResult {
  status: VerificationStatus;
  confirmations?: number;
  reason?: VerificationReason;
}

/** Server-side terms the on-chain transaction is checked against. */
export interface ExpectedPayment {
  hash: string;
  sender: string;
  recipient: string;
  /** Integer base units (luna), decimal string. Compared via BigInt, never floats. */
  amount: string;
  data: string;
}

export interface Assessment {
  outcome: VerificationStatus;
  confirmations: number | null;
  mismatch?: VerificationMismatch;
}

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

function canonicalizeTxAddress(value: unknown): string | null {
  try {
    if (typeof value !== 'string') return null;
    return canonicalizeNimiqAddress(value);
  } catch (err) {
    if (err instanceof InvalidAddressError) return null;
    throw err;
  }
}

/**
 * Pure verification predicate — exact checks in the locked order:
 * 1. tx exists; 2. sender; 3. recipient; 4. integer amount via BigInt;
 * 5. data byte-for-byte; 6. confirmations >= 3; 7. hash assert.
 * Failures of (2)-(5)/(7) → review; (6) → pending; (1) → pending.
 * A null confirmations count means "no confirmation evidence" → pending:
 * money is never verified on incomplete data.
 */
export function assessTransaction(
  tx: TxRecord | null,
  expected: ExpectedPayment,
): Assessment {
  if (tx === null) {
    return { outcome: 'pending', confirmations: null };
  }
  const expectedSender = canonicalizeOr500(expected.sender);
  const expectedRecipient = canonicalizeOr500(expected.recipient);
  const txSender = canonicalizeTxAddress(tx.sender);
  if (txSender === null || txSender !== expectedSender) {
    return { outcome: 'review', confirmations: tx.confirmations, mismatch: 'sender_mismatch' };
  }
  const txRecipient = canonicalizeTxAddress(tx.recipient);
  if (txRecipient === null || txRecipient !== expectedRecipient) {
    return { outcome: 'review', confirmations: tx.confirmations, mismatch: 'recipient_mismatch' };
  }
  let amountsEqual = false;
  try {
    amountsEqual = BigInt(tx.value) === BigInt(expected.amount);
  } catch {
    amountsEqual = false;
  }
  if (!amountsEqual) {
    return { outcome: 'review', confirmations: tx.confirmations, mismatch: 'amount_mismatch' };
  }
  if (tx.data !== expected.data) {
    return { outcome: 'review', confirmations: tx.confirmations, mismatch: 'data_mismatch' };
  }
  if (tx.confirmations === null || tx.confirmations < REQUIRED_CONFIRMATIONS) {
    return { outcome: 'pending', confirmations: tx.confirmations };
  }
  if (tx.hash.toLowerCase() !== expected.hash.toLowerCase()) {
    return { outcome: 'review', confirmations: tx.confirmations, mismatch: 'hash_mismatch' };
  }
  return { outcome: 'verified', confirmations: tx.confirmations };
}

/**
 * Pure timeout predicate: a payment_pending claim whose submission is older
 * than the window ages to review on its next pending outcome. A null
 * submittedAt (should not happen for submitted intents) never times out.
 */
export function isPaymentPendingTimedOut(
  submittedAt: Date | null,
  now: Date,
  timeoutSeconds: number,
): boolean {
  if (submittedAt === null) return false;
  return now.getTime() - submittedAt.getTime() > timeoutSeconds * 1000;
}

export interface VerifyPaymentResult {
  claim: ClaimView;
  intent: PaymentIntentView;
  verification: VerificationResult;
  /** Server-log context (specifics for adjudication). Never sent to the client. */
  audit: Record<string, unknown>;
}

function auditBase(
  claimId: string,
  intentId: string,
  txHash: string | null,
): Record<string, unknown> {
  return { claimId, intentId, txHash };
}

export async function verifyPayment(
  db: Db,
  options: { claimId: string; buyerId: string; rpc: NimiqRpcClient; now?: Date; requestId?: string | null },
): Promise<VerifyPaymentResult> {
  const now = options.now ?? new Date();
  const loaded = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'NOT_FOUND', 'Claim not found.');
    }
    const intentRows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, claim.id))
      .limit(1);
    return { claim, intent: intentRows[0] ?? null };
  });
  const { claim, intent } = loaded;

  // Idempotent no-ops: terminal states never trigger chain lookups.
  if (claim.status === 'paid') {
    if (!intent) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return {
      claim: toClaimView(claim),
      intent: toPaymentIntentView(intent),
      verification: { status: 'verified' },
      audit: { ...auditBase(claim.id, intent.id, intent.txHash), outcome: 'noop-paid' },
    };
  }
  if (claim.status === 'payment_review') {
    if (!intent) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return {
      claim: toClaimView(claim),
      intent: toPaymentIntentView(intent),
      verification: { status: 'review' },
      audit: { ...auditBase(claim.id, intent.id, intent.txHash), outcome: 'noop-review' },
    };
  }
  if (claim.status !== 'payment_pending') {
    throw new AppError(
      409,
      'CLAIM_NOT_IN_PAYMENT_PENDING',
      'This claim is not awaiting payment verification.',
    );
  }
  if (!intent) {
    throw new AppError(409, 'PAYMENT_INTENT_REQUIRED', 'Create a payment intent first.');
  }
  if (intent.txHash === null || intent.status !== 'submitted') {
    // Defensive: a pending claim with no recorded submission has nothing to
    // look up. Pending (not review) — there is no evidence of anything wrong.
    return {
      claim: toClaimView(claim),
      intent: toPaymentIntentView(intent),
      verification: { status: 'pending' },
      audit: { ...auditBase(claim.id, intent.id, intent.txHash), outcome: 'noop-no-submission' },
    };
  }

  // Chain lookups happen OUTSIDE any DB transaction — never hold a pooled
  // connection across a 5s network call.
  const txHash = intent.txHash;
  const found = await options.rpc.getTransactionByHash(txHash);
  let effective: TxRecord | null = found;
  if (found && found.confirmations === null && found.blockNumber !== null) {
    // Fallback path (never observed live — the RPC exposes confirmations
    // directly): head height minus tx block height. Only used when the
    // primary field is absent; still never verified without evidence.
    const head = await options.rpc.getBlockNumber();
    effective = { ...found, confirmations: Math.max(0, head - found.blockNumber) };
  }
  const assessment = assessTransaction(effective, {
    hash: txHash,
    sender: intent.expectedSender,
    recipient: intent.expectedRecipient,
    amount: intent.expectedAmountNim.toString(),
    data: intent.expectedData,
  });

  let outcome = assessment.outcome;
  let reason: VerificationReason | undefined = assessment.mismatch;
  if (
    outcome === 'pending' &&
    isPaymentPendingTimedOut(intent.submittedAt, now, getPaymentReviewTimeoutSeconds())
  ) {
    outcome = 'review';
    reason = 'timeout';
  }

  if (outcome === 'pending') {
    const verification: VerificationResult =
      assessment.confirmations === null
        ? { status: 'pending' }
        : { status: 'pending', confirmations: assessment.confirmations };
    return {
      claim: toClaimView(claim),
      intent: toPaymentIntentView(intent),
      verification,
      audit: {
        ...auditBase(claim.id, intent.id, txHash),
        outcome: 'pending',
        confirmations: assessment.confirmations,
      },
    };
  }

  // State-changing outcomes run under a row lock with conditional writes so a
  // concurrent verifier fails closed into the winner's state (read back below).
  return db.transaction(async (tx) => {
    const freshRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, claim.id), eq(claims.buyerId, options.buyerId)))
      .for('update')
      .limit(1);
    const fresh = freshRows[0];
    if (!fresh) {
      throw new AppError(404, 'NOT_FOUND', 'Claim not found.');
    }
    const intentRows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, fresh.id))
      .limit(1);
    const freshIntent = intentRows[0];
    if (!freshIntent) {
      throw new AppError(409, 'PAYMENT_INTENT_REQUIRED', 'Create a payment intent first.');
    }
    if (fresh.status !== 'payment_pending') {
      // Lost a race: another call moved the claim first. Return its state.
      const verification: VerificationResult =
        fresh.status === 'paid' ? { status: 'verified' } : { status: 'review' };
      return {
        claim: toClaimView(fresh),
        intent: toPaymentIntentView(freshIntent),
        verification,
        audit: { ...auditBase(fresh.id, freshIntent.id, txHash), outcome: 'race-noop' },
      };
    }
    if (outcome === 'verified') {
      const updatedIntent = await tx
        .update(paymentIntents)
        .set({ status: 'verified', verifiedAt: now, updatedAt: now })
        .where(and(eq(paymentIntents.id, freshIntent.id), eq(paymentIntents.status, 'submitted')))
        .returning();
      const updatedClaim = await tx
        .update(claims)
        .set({ status: 'paid', updatedAt: now })
        .where(and(eq(claims.id, fresh.id), eq(claims.status, 'payment_pending')))
        .returning();
      const finalIntent = updatedIntent[0] ?? freshIntent;
      const finalClaim = updatedClaim[0] ?? fresh;
      if (updatedClaim[0]) {
        await writeAuditEvent(tx, {
          actorUserId: options.buyerId,
          eventType: 'payment.verified',
          entityType: 'claim',
          entityId: fresh.id,
          requestId: options.requestId ?? null,
          metadata: {
            intentId: freshIntent.id,
            from: 'payment_pending',
            to: 'paid',
            confirmations: assessment.confirmations,
          },
        });
      }
      return {
        claim: toClaimView(finalClaim),
        intent: toPaymentIntentView(finalIntent),
        verification: {
          status: 'verified',
          confirmations: assessment.confirmations ?? undefined,
        },
        audit: {
          ...auditBase(fresh.id, freshIntent.id, txHash),
          outcome: 'verified',
          confirmations: assessment.confirmations,
        },
      };
    }
    // Review (mismatch or timeout): intent → review, claim → payment_review.
    // Inventory is NOT restored — the buyer might have paid. Phase 10 decides.
    const updatedIntent = await tx
      .update(paymentIntents)
      .set({ status: 'review', updatedAt: now })
      .where(and(eq(paymentIntents.id, freshIntent.id), eq(paymentIntents.status, 'submitted')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'payment_review', updatedAt: now })
      .where(and(eq(claims.id, fresh.id), eq(claims.status, 'payment_pending')))
      .returning();
    const finalIntent = updatedIntent[0] ?? freshIntent;
    const finalClaim = updatedClaim[0] ?? fresh;
    if (updatedClaim[0]) {
      await writeAuditEvent(tx, {
        actorUserId: options.buyerId,
        eventType: 'payment.review',
        entityType: 'claim',
        entityId: fresh.id,
        requestId: options.requestId ?? null,
        metadata: {
          intentId: freshIntent.id,
          from: 'payment_pending',
          to: 'payment_review',
          reason,
        },
      });
    }
    return {
      claim: toClaimView(finalClaim),
      intent: toPaymentIntentView(finalIntent),
      verification: { status: 'review', reason },
      audit: {
        ...auditBase(fresh.id, freshIntent.id, txHash),
        outcome: 'review',
        reason,
        confirmations: assessment.confirmations,
        expected: {
          sender: freshIntent.expectedSender,
          recipient: freshIntent.expectedRecipient,
          amount: freshIntent.expectedAmountNim.toString(),
          data: freshIntent.expectedData,
        },
        actual:
          found === null
            ? null
            : {
                sender: found.sender,
                recipient: found.recipient,
                value: found.value,
                data: found.data,
                hash: found.hash,
              },
      },
    };
  });
}
