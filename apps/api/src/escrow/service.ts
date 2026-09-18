// Phase 14d-2: USDT escrow service (deposit path only).
// Phase 14d-3a: delivery + release slice (markDelivered, confirmReceipt).
// No dispute/admin/refund logic — those are 14d-3b. No NIM path.
//
// Pricing note: amount_base_units is snapshotted from the slot's price_usdt
// (the USDT-denominated price is used as the USDT base-unit amount). This is
// the current pricing model and out of scope to change here.
//
// Buyer-binding note (model B, owner-decided): deposit verification matches
// on escrowId and exact amount only. The on-chain Deposited.buyer (an EVM
// address recorded by the contract for refund routing) is NOT compared
// against users.wallet_address (a Nimiq address) — impossible across chains.
// The escrowId is the capability: server-generated 32-byte random, returned
// only to the authenticated buyer, single-deposit-per-escrowId enforced
// on-chain with an exact-amount check. Claim buyer-ownership (foreign → 404)
// is unchanged.
//
// Window-timing note: the verification window is measured from
// claims.deposit_submitted_at, set on the active_hold → deposit_submitted
// transition, cleared to NULL on expiry to payment_review, left in place on
// escrow_funded as historical record.
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDb } from '../../../../db/client';
import { claims, escrows, slots, users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { truncateWalletAddress } from '../auth/nimiq-address';
import { writeNotification } from '../notifications/service';
import { getEscrowContractAddress, getUsdtTokenAddress } from './polygon/client';
import type { EscrowContractClient } from '../../../../packages/shared/src/escrow/contract';
import {
  getEscrowDeliveryWindowSeconds,
  getEscrowDepositVerificationSeconds,
  getEscrowDisputeWindowSeconds,
  getEscrowRefundConfirmations,
  getEscrowReleaseConfirmations,
} from '../env';
import { disputeCallData, type DisputeInstruction } from './polygon/client';
import { isUniqueViolation } from '../claims/service';
import { isContactNoteVisibleToBuyer, toClaimView, type ClaimView } from '../claims/claim-view';
import { AppError } from '../http/errors';
import { assessDeposit } from './polygon/verify-deposit';
import { EscrowContractUnavailableError, EscrowSignerUnavailableError } from './polygon/client';

type Db = ReturnType<typeof getDb>;

export interface EscrowView {
  id: string;
  claim_id: string;
  buyer_id: string;
  payment_token: string;
  amount_base_units: string;
  status: string;
  contract_address: string | null;
  on_chain_escrow_id: string | null;
  deposit_tx_hash: string | null;
  funded_at: string | null;
  delivery_deadline: string | null;
  provider_payout_address: string | null;
  delivered_at: string | null;
  dispute_window_ends: string | null;
  disputed_at: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  resolved_at: string | null;
  // Admin resolution reasoning. Populated for provider and admin views
  // only — the buyer view carries null (the buyer sees THAT a resolution
  // happened via status/resolved_at, not the admin's reasoning).
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepositInstruction {
  contractAddress: string;
  /** Phase 14e P1 (D7 variant B): canonical USDT token address for the approve() call. Served, never hardcoded. */
  tokenAddress: string;
  usdtAmount: string;
  onChainEscrowId: string;
  approveTo: string;
  approveAmount: string;
  buyerWallet: string;
}

export type EscrowRow = typeof escrows.$inferSelect;

export function toEscrowView(row: EscrowRow, includeResolutionNotes = false): EscrowView {
  return {
    id: row.id,
    claim_id: row.claimId,
    buyer_id: row.buyerId,
    payment_token: row.paymentToken,
    amount_base_units: row.amountBaseUnits.toString(),
    status: row.status,
    contract_address: row.contractAddress,
    on_chain_escrow_id: row.onChainEscrowId,
    deposit_tx_hash: row.depositTxHash,
    funded_at: row.fundedAt ? row.fundedAt.toISOString() : null,
    delivery_deadline: row.deliveryDeadline ? row.deliveryDeadline.toISOString() : null,
    provider_payout_address: row.providerPayoutAddress,
    delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    dispute_window_ends: row.disputeWindowEnds ? row.disputeWindowEnds.toISOString() : null,
    disputed_at: row.disputedAt ? row.disputedAt.toISOString() : null,
    release_tx_hash: row.releaseTxHash,
    refund_tx_hash: row.refundTxHash,
    resolved_at: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolution_notes: includeResolutionNotes ? row.resolutionNotes : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function newOnChainEscrowId(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

function contractAddressOr503(): string {
  try {
    return getEscrowContractAddress();
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw new AppError(
        503,
        'ESCROW_CONTRACT_UNAVAILABLE',
        'Escrow service is temporarily unavailable. Please try again.',
      );
    }
    throw err;
  }
}

/** Phase 14e P1 (D7 variant B): token address or the same generic escrow 503. */
function tokenAddressOr503(): string {
  try {
    return getUsdtTokenAddress();
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw new AppError(
        503,
        'ESCROW_CONTRACT_UNAVAILABLE',
        'Escrow service is temporarily unavailable. Please try again.',
      );
    }
    throw err;
  }
}

/**
 * Create (or idempotently return) the escrow for one claim.
 * Token gate first after ownership: NIM → 409 ESCROW_TOKEN_UNSUPPORTED.
 * Existing escrow → idempotent return pre-funding; 409 ESCROW_ALREADY_FUNDED
 * post-funding. Otherwise creates status='created' with NULL funded fields.
 */
export async function createEscrowIntent(
  db: Db,
  options: { claimId: string; buyerId: string; token: string; now?: Date; requestId?: string | null },
): Promise<{ escrow: EscrowView; claim: ClaimView; depositInstruction: DepositInstruction }> {
  const now = options.now ?? new Date();
  if (options.token !== 'USDT_POLYGON') {
    throw new AppError(409, 'ESCROW_TOKEN_UNSUPPORTED', 'Only USDT on Polygon is supported right now.');
  }
  const decided = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const existing = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .limit(1);
    if (existing[0]) {
      if (existing[0].status !== 'created' || claim.status === 'escrow_funded') {
        throw new AppError(409, 'ESCROW_ALREADY_FUNDED', 'This escrow is already funded.');
      }
      return { escrowRow: existing[0], claimRow: claim, created: false as const };
    }
    if (claim.status === 'escrow_funded') {
      throw new AppError(409, 'ESCROW_ALREADY_FUNDED', 'This escrow is already funded.');
    }
    if (claim.status !== 'active_hold') {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be funded right now.');
    }
    const contractAddress = contractAddressOr503();
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
    let inserted;
    try {
      inserted = await tx
        .insert(escrows)
        .values({
          claimId: claim.id,
          buyerId: options.buyerId,
          providerId: slot.providerId,
          paymentToken: 'USDT_POLYGON',
          amountBaseUnits: slot.priceUsdt,
          status: 'created',
          contractAddress,
          onChainEscrowId: newOnChainEscrowId(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.claimId, claim.id))
          .limit(1);
        if (winner[0]) {
          if (winner[0].status !== 'created') {
            throw new AppError(409, 'ESCROW_ALREADY_FUNDED', 'This escrow is already funded.');
          }
          return { escrowRow: winner[0], claimRow: claim, created: false as const };
        }
      }
      throw err;
    }
    const escrowRow = inserted[0];
    if (!escrowRow) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return { escrowRow, claimRow: claim, created: true as const };
  });
  const escrow = decided.escrowRow;
  if (!escrow.onChainEscrowId || !escrow.contractAddress) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  const buyerWalletRows = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, options.buyerId))
    .limit(1);
  const buyerWallet = buyerWalletRows[0]?.walletAddress ?? '';
  const amount = escrow.amountBaseUnits.toString();
  return {
    escrow: toEscrowView(escrow),
    claim: toClaimView(decided.claimRow),
    depositInstruction: {
      contractAddress: escrow.contractAddress,
      tokenAddress: tokenAddressOr503(),
      usdtAmount: amount,
      onChainEscrowId: escrow.onChainEscrowId,
      approveTo: escrow.contractAddress,
      approveAmount: amount,
      buyerWallet,
    },
  };
}

/**
 * Record the buyer's deposit reference (untrusted hash — NOT verified here).
 * Buyer-owned claim in active_hold or deposit_submitted. Idempotent on
 * identical hash; a different hash while already submitted → 409
 * PAYMENT_ALREADY_SUBMITTED (chosen over CONFLICT for consistency with the
 * deprecated payment-submission path; documented here and kept consistent).
 * No escrow row → 404 ESCROW_NOT_FOUND. Already funded → 409
 * ESCROW_ALREADY_FUNDED.
 */
export async function submitDepositReference(
  db: Db,
  options: { claimId: string; buyerId: string; txHash: string; now?: Date; requestId?: string | null },
): Promise<{ escrow: EscrowView; claim: ClaimView }> {
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
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    if (claim.status === 'escrow_funded') {
      throw new AppError(409, 'ESCROW_ALREADY_FUNDED', 'This escrow is already funded.');
    }
    if (claim.status !== 'active_hold' && claim.status !== 'deposit_submitted') {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be funded right now.');
    }
    const escrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .limit(1);
    const escrow = escrowRows[0];
    if (!escrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim. Create one first.');
    }
    if (escrow.status !== 'created') {
      throw new AppError(409, 'ESCROW_ALREADY_FUNDED', 'This escrow is already funded.');
    }
    if (escrow.depositTxHash !== null) {
      if (escrow.depositTxHash === options.txHash) {
        return { escrow: toEscrowView(escrow), claim: toClaimView(claim) };
      }
      throw new AppError(
        409,
        'PAYMENT_ALREADY_SUBMITTED',
        'A different transaction was already submitted for this claim.',
      );
    }
    let updatedEscrow;
    try {
      const rows = await tx
        .update(escrows)
        .set({ depositTxHash: options.txHash, updatedAt: now })
        .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'created')))
        .returning();
      updatedEscrow = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'PAYMENT_ALREADY_SUBMITTED', 'This transaction was already submitted.');
      }
      throw err;
    }
    if (!updatedEscrow) {
      const reread = await tx.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1);
      if (reread[0]?.depositTxHash === options.txHash) {
        const freshClaim =
          (await tx.select().from(claims).where(eq(claims.id, claim.id)).limit(1))[0] ?? claim;
        return { escrow: toEscrowView(reread[0]), claim: toClaimView(freshClaim) };
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
        .set({ status: 'deposit_submitted', depositSubmittedAt: now, updatedAt: now })
        .where(and(eq(claims.id, claim.id), eq(claims.status, 'active_hold')))
        .returning();
      if (moved[0]) {
        freshClaim = moved[0];
      }
    }
    await writeAuditEvent(tx, {
      actorUserId: options.buyerId,
      eventType: 'escrow.submitted',
      entityType: 'claim',
      entityId: claim.id,
      requestId: options.requestId ?? null,
      metadata: { escrowId: escrow.id, from: claim.status, to: freshClaim.status },
    });
    return { escrow: toEscrowView(updatedEscrow), claim: toClaimView(freshClaim) };
  });
}

export type VerifyDepositStatus = 'pending' | 'mismatch' | 'review' | 'funded';

export interface VerifyDepositResult {
  status: VerifyDepositStatus;
  reason?: 'amount' | 'escrow_id' | 'timeout';
  escrow: EscrowView;
  claim: ClaimView;
}

/** True when the deposit_submitted window has elapsed (measured from deposit_submitted_at). */
export function isDepositVerificationTimedOut(
  depositSubmittedAt: Date | null,
  now: Date,
  timeoutSeconds: number,
): boolean {
  if (depositSubmittedAt === null) {
    return false;
  }
  return now.getTime() - depositSubmittedAt.getTime() > timeoutSeconds * 1000;
}

/**
 * On-demand deposit verification (buyer polling, mirroring deprecated
 * verify-payment). Already funded → 200 no-op without RPC. Otherwise loads
 * escrow, reads the Deposited event, assesses, and acts:
 * pending → no-op (or payment_review on window expiry); mismatch → 200 with
 * reason, no write; matched → single transaction funding both rows.
 * Concurrent verifies fail closed into the winner's state.
 */
export async function verifyDeposit(
  db: Db,
  options: {
    claimId: string;
    buyerId: string;
    client: EscrowContractClient;
    now?: Date;
    requestId?: string | null;
  },
): Promise<VerifyDepositResult> {
  const now = options.now ?? new Date();
  const loaded = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const escrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .limit(1);
    return { claim, escrow: escrowRows[0] ?? null };
  });
  const { claim, escrow } = loaded;
  if (escrow && claim.status === 'escrow_funded' && escrow.status === 'funded') {
    return { status: 'funded', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
  }
  if (claim.status === 'payment_review') {
    if (!escrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    return { status: 'review', reason: 'timeout', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
  }
  if (claim.status !== 'deposit_submitted') {
    throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim is not awaiting deposit verification.');
  }
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  if (!escrow.onChainEscrowId) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  let event;
  try {
    event = await options.client.getDepositEvent(escrow.onChainEscrowId);
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw new AppError(
        503,
        'ESCROW_CONTRACT_UNAVAILABLE',
        'Deposit verification is temporarily unavailable. Please try again.',
      );
    }
    throw err;
  }
  // Model B: escrowId + exact amount only. The on-chain buyer is recorded
  // by the contract for refund routing and is not compared here.
  const assessment = assessDeposit(event, {
    onChainEscrowId: escrow.onChainEscrowId,
    amountBaseUnits: escrow.amountBaseUnits,
  });
  if (assessment.status === 'mismatch') {
    return {
      status: 'mismatch',
      reason: assessment.reason,
      escrow: toEscrowView(escrow),
      claim: toClaimView(claim),
    };
  }
  if (assessment.status === 'pending') {
    const timedOut = isDepositVerificationTimedOut(
      claim.depositSubmittedAt,
      now,
      getEscrowDepositVerificationSeconds(),
    );
    if (!timedOut) {
      return { status: 'pending', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
    }
    return db.transaction(async (tx) => {
      const freshRows = await tx
        .select()
        .from(claims)
        .where(and(eq(claims.id, claim.id), eq(claims.buyerId, options.buyerId)))
        .for('update')
        .limit(1);
      const fresh = freshRows[0];
      if (!fresh) {
        throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
      }
      if (fresh.status !== 'deposit_submitted') {
        const freshEscrow =
          (await tx.select().from(escrows).where(eq(escrows.claimId, fresh.id)).limit(1))[0] ??
          escrow;
        if (fresh.status === 'escrow_funded') {
          return { status: 'funded' as const, escrow: toEscrowView(freshEscrow), claim: toClaimView(fresh) };
        }
        return {
          status: 'review' as const,
          reason: 'timeout' as const,
          escrow: toEscrowView(freshEscrow),
          claim: toClaimView(fresh),
        };
      }
      const moved = await tx
        .update(claims)
        .set({ status: 'payment_review', depositSubmittedAt: null, updatedAt: now })
        .where(and(eq(claims.id, fresh.id), eq(claims.status, 'deposit_submitted')))
        .returning();
      const finalClaim = moved[0] ?? fresh;
      if (moved[0]) {
        await writeAuditEvent(tx, {
          actorUserId: options.buyerId,
          eventType: 'escrow.review',
          entityType: 'claim',
          entityId: fresh.id,
          requestId: options.requestId ?? null,
          metadata: { escrowId: escrow.id, from: 'deposit_submitted', to: 'payment_review', reason: 'timeout' },
        });
      }
      return {
        status: 'review' as const,
        reason: 'timeout' as const,
        escrow: toEscrowView(escrow),
        claim: toClaimView(finalClaim),
      };
    });
  }
  // Matched — money is money, even past the window. Single transaction funds
  // both rows with conditional writes so a concurrent verifier fails closed.
  return db.transaction(async (tx) => {
    const freshRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, claim.id), eq(claims.buyerId, options.buyerId)))
      .for('update')
      .limit(1);
    const fresh = freshRows[0];
    if (!fresh) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const freshEscrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, fresh.id))
      .limit(1);
    const freshEscrow = freshEscrowRows[0];
    if (!freshEscrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    if (fresh.status !== 'deposit_submitted') {
      if (fresh.status === 'escrow_funded') {
        return { status: 'funded' as const, escrow: toEscrowView(freshEscrow), claim: toClaimView(fresh) };
      }
      return {
        status: 'review' as const,
        reason: 'timeout' as const,
        escrow: toEscrowView(freshEscrow),
        claim: toClaimView(fresh),
      };
    }
    const deliveryDeadline = new Date(now.getTime() + getEscrowDeliveryWindowSeconds() * 1000);
    const depositTxHash = freshEscrow.depositTxHash ?? event?.txHash ?? null;
    const updatedEscrowRows = await tx
      .update(escrows)
      .set({
        status: 'funded',
        depositTxHash,
        fundedAt: now,
        deliveryDeadline,
        updatedAt: now,
      })
      .where(and(eq(escrows.id, freshEscrow.id), eq(escrows.status, 'created')))
      .returning();
    const updatedClaimRows = await tx
      .update(claims)
      .set({ status: 'escrow_funded', updatedAt: now })
      .where(and(eq(claims.id, fresh.id), eq(claims.status, 'deposit_submitted')))
      .returning();
    const finalEscrow = updatedEscrowRows[0] ?? freshEscrow;
    const finalClaim = updatedClaimRows[0] ?? fresh;
    if (updatedClaimRows[0]) {
      await writeAuditEvent(tx, {
        actorUserId: options.buyerId,
        eventType: 'escrow.funded',
        entityType: 'claim',
        entityId: fresh.id,
        requestId: options.requestId ?? null,
        metadata: { escrowId: freshEscrow.id, from: 'deposit_submitted', to: 'escrow_funded' },
      });
      // Phase 14l-2: provider notification in the same transaction. The
      // conditional UPDATE above admits exactly one winner, so exactly one
      // notification is written; concurrent losers take the funded no-op
      // branch above and write nothing.
      const slotTitleRows = await tx
        .select({ title: slots.title })
        .from(slots)
        .where(eq(slots.id, fresh.slotId))
        .limit(1);
      const buyerRows = await tx
        .select({ walletAddress: users.walletAddress })
        .from(users)
        .where(eq(users.id, fresh.buyerId))
        .limit(1);
      const buyerDisplay = buyerRows[0]
        ? truncateWalletAddress(buyerRows[0].walletAddress)
        : 'a buyer';
      await writeNotification(tx, {
        userId: freshEscrow.providerId,
        type: 'slot_funded',
        entityType: 'slot',
        entityId: fresh.slotId,
        title: 'Slot funded',
        body: `Your slot "${slotTitleRows[0]?.title ?? 'your slot'}" was funded — ${buyerDisplay} is waiting for delivery.`,
      });
    }
    return { status: 'funded' as const, escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
  });
}

/** Buyer-scoped escrow read; foreign or missing claim → 404; no escrow → 404 ESCROW_NOT_FOUND. */
export async function getEscrowForBuyer(
  db: Db,
  options: {
    claimId: string;
    buyerId: string;
    client?: EscrowContractClient;
    now?: Date;
    requestId?: string | null;
  },
): Promise<{ escrow: EscrowView; claim: ClaimView }> {
  const claimRows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
    .limit(1);
  const claim = claimRows[0];
  if (!claim) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }
  const escrowRows = await db
    .select()
    .from(escrows)
    .where(eq(escrows.claimId, claim.id))
    .limit(1);
  const escrow = escrowRows[0];
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  const current = await maybeAdvanceEscrow(db, escrow, options);
  // The transition may have moved the claim too (refunded/released) — the
  // projection must reflect the post-transition row, not the pre-read one.
  const freshClaimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claim.id))
    .limit(1);
  // Phase 14d-4: gated contact note on the buyer view, evaluated against
  // the post-transition escrow status (a funded row that just flipped to
  // refunding hides the note on this same read).
  const slotRows = await db.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
  const note =
    slotRows[0] && isContactNoteVisibleToBuyer(current.status)
      ? slotRows[0].providerContactNote
      : null;
  return { escrow: toEscrowView(current), claim: toClaimView(freshClaimRows[0] ?? claim, note) };
}

/** Provider-scoped escrow read; foreign or missing claim → 404; no escrow → 404 ESCROW_NOT_FOUND. */
export async function getEscrowForProvider(
  db: Db,
  options: {
    claimId: string;
    providerId: string;
    client?: EscrowContractClient;
    now?: Date;
    requestId?: string | null;
  },
): Promise<{ escrow: EscrowView; claim: ClaimView }> {
  const claimRows = await db.select().from(claims).where(eq(claims.id, options.claimId)).limit(1);
  const claim = claimRows[0];
  if (!claim) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }
  const slotRows = await db.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
  const slot = slotRows[0];
  if (!slot) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  if (slot.providerId !== options.providerId) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }
  const escrowRows = await db
    .select()
    .from(escrows)
    .where(eq(escrows.claimId, claim.id))
    .limit(1);
  const escrow = escrowRows[0];
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  const current = await maybeAdvanceEscrow(db, escrow, options);
  const freshClaimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claim.id))
    .limit(1);
  return { escrow: toEscrowView(current, true), claim: toClaimView(freshClaimRows[0] ?? claim) };
}

/**
 * Normalize an EVM address for storage/comparison (lowercase — EIP-55
 * checksum is display encoding, not identity). Returns null when malformed.
 *
 * IMPLEMENTATION DETAIL — AGENT MAY DECIDE: lowercase storage; all
 * comparisons are exact on the normalized form.
 */
export function normalizeEvmAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!/^0[xX][0-9a-fA-F]{40}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * Provider marks the service delivered. Claim must be escrow_funded and the
 * slot provider-owned (foreign → 404 CLAIM_NOT_FOUND, never an existence
 * leak); anything else → 409 CLAIM_NOT_PAYABLE (the claim is not payable or
 * deliverable in its current state — ESCROW_NOT_DELIVERED would describe a
 * claim that is already delivered, which is not the case here).
 *
 * The provider payout address is stored immutably on first success; a repeat
 * call with the same address is a 200 no-op (no second audit), with a
 * different address → 409 CONFLICT.
 */
export async function markDelivered(
  db: Db,
  options: {
    claimId: string;
    providerId: string;
    providerPayoutAddress: string;
    now?: Date;
    requestId?: string | null;
  },
): Promise<{ escrow: EscrowView; claim: ClaimView }> {
  const now = options.now ?? new Date();
  const normalized = normalizeEvmAddress(options.providerPayoutAddress);
  if (normalized === null) {
    throw new AppError(400, 'INVALID_INPUT', 'Provider payout address must be a 0x-prefixed EVM address.');
  }
  return db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, options.claimId))
      .for('update')
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const slotRows = await tx.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
    const slot = slotRows[0];
    if (!slot) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    if (slot.providerId !== options.providerId) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const escrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .for('update')
      .limit(1);
    const escrow = escrowRows[0];
    if (!escrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    if (claim.status === 'delivered') {
      if (escrow.status !== 'delivered') {
        throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
      }
      if (escrow.providerPayoutAddress !== normalized) {
        throw new AppError(409, 'CONFLICT', 'A different payout address is already recorded for this escrow.');
      }
      return { escrow: toEscrowView(escrow), claim: toClaimView(claim) };
    }
    if (claim.status !== 'escrow_funded') {
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be marked delivered right now.');
    }
    if (escrow.status !== 'funded') {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    if (escrow.providerPayoutAddress !== null && escrow.providerPayoutAddress !== normalized) {
      throw new AppError(409, 'CONFLICT', 'A different payout address is already recorded for this escrow.');
    }
    const disputeWindowEnds = new Date(now.getTime() + getEscrowDisputeWindowSeconds() * 1000);
    const updatedEscrow = await tx
      .update(escrows)
      .set({
        providerPayoutAddress: normalized,
        deliveredAt: now,
        disputeWindowEnds,
        status: 'delivered',
        updatedAt: now,
      })
      .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'funded')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'delivered', updatedAt: now })
      .where(and(eq(claims.id, claim.id), eq(claims.status, 'escrow_funded')))
      .returning();
    const finalEscrow = updatedEscrow[0];
    const finalClaim = updatedClaim[0];
    if (!finalEscrow || !finalClaim) {
      // Lost a race: re-read and resolve idempotent vs conflict.
      const rereadEscrow = (
        await tx.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1)
      )[0];
      const rereadClaim = (
        await tx.select().from(claims).where(eq(claims.id, claim.id)).limit(1)
      )[0];
      if (rereadClaim?.status === 'delivered' && rereadEscrow?.status === 'delivered') {
        if (rereadEscrow.providerPayoutAddress !== normalized) {
          throw new AppError(409, 'CONFLICT', 'A different payout address is already recorded for this escrow.');
        }
        return { escrow: toEscrowView(rereadEscrow), claim: toClaimView(rereadClaim) };
      }
      throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be marked delivered right now.');
    }
    await writeAuditEvent(tx, {
      actorUserId: options.providerId,
      eventType: 'escrow.delivered',
      entityType: 'claim',
      entityId: claim.id,
      requestId: options.requestId ?? null,
      metadata: { escrowId: escrow.id, claimId: claim.id, from: 'escrow_funded', to: 'delivered' },
    });
    // Phase 14l-2: buyer notification in the same transaction. This is the
    // winner path only (losers return the delivered no-op or throw above),
    // so exactly one notification is written per delivery.
    await writeNotification(tx, {
      userId: claim.buyerId,
      type: 'slot_delivered',
      entityType: 'claim',
      entityId: claim.id,
      title: 'Marked delivered',
      body: `Your claim for "${slot.title}" was marked delivered — confirm receipt to release funds.`,
    });
    return { escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
  });
}

export type ConfirmReceiptStatus = 'pending' | 'released';

export interface ConfirmReceiptResult {
  status: ConfirmReceiptStatus;
  confirmations?: number;
  escrow: EscrowView;
  claim: ClaimView;
}

function releaseFailed(): AppError {
  return new AppError(
    503,
    'ESCROW_RELEASE_FAILED',
    'Release is temporarily unavailable. Please try again.',
  );
}

/**
 * Buyer confirms receipt: broadcast the contract release on first call
 * (status stays delivered, returns pending), then poll the receipt until
 * the confirmation policy (ESCROW_RELEASE_CONFIRMATIONS, default 3) flips
 * both rows to released in one transaction. Concurrent calls fail closed
 * into the winner's state; already released is a no-op without any RPC.
 * Signer/RPC/contract failures → 503 ESCROW_RELEASE_FAILED, no state change.
 */
export async function confirmReceipt(
  db: Db,
  options: {
    claimId: string;
    buyerId: string;
    client: EscrowContractClient;
    now?: Date;
    requestId?: string | null;
  },
): Promise<ConfirmReceiptResult> {
  const now = options.now ?? new Date();
  const loaded = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const escrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .limit(1);
    return { claim, escrow: escrowRows[0] ?? null };
  });
  const { claim, escrow } = loaded;
  if (claim.status === 'released') {
    if (!escrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    return { status: 'released', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
  }
  if (claim.status !== 'delivered') {
    throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim is not awaiting receipt confirmation.');
  }
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  if (escrow.status !== 'delivered') {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  if (!escrow.onChainEscrowId || !escrow.providerPayoutAddress) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }

  let releaseTxHash = escrow.releaseTxHash;
  if (releaseTxHash === null) {
    let broadcast: { txHash: string };
    try {
      broadcast = await options.client.release(escrow.onChainEscrowId, escrow.providerPayoutAddress);
    } catch (err) {
      if (err instanceof EscrowSignerUnavailableError || err instanceof EscrowContractUnavailableError) {
        throw releaseFailed();
      }
      throw err;
    }
    // Conditional store: a concurrent confirmer may have won the broadcast.
    // The loser falls through to the receipt branch on the winner's hash —
    // never an error, never a second audit for the same submission. A UNIQUE
    // violation here means the broadcast hash is already recorded somewhere:
    // own row carrying it is the same race (proceed); anything else is a
    // release replay across escrows → 409 CONFLICT (the on-chain
    // single-release rule is the backstop; funds can never double-move).
    let replayConflict = false;
    const stored = await db.transaction(async (tx) => {
      try {
        const rows = await tx
          .update(escrows)
          .set({ releaseTxHash: broadcast.txHash, updatedAt: now })
          .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'delivered')))
          .returning();
        return rows[0] ?? null;
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }
        replayConflict = true;
        return null;
      }
    });
    if (stored) {
      await db.transaction(async (tx) => {
        await writeAuditEvent(tx, {
          actorUserId: options.buyerId,
          eventType: 'escrow.release_submitted',
          entityType: 'claim',
          entityId: claim.id,
          requestId: options.requestId ?? null,
          metadata: { escrowId: escrow.id, claimId: claim.id, txHash: broadcast.txHash },
        });
      });
      const fresh = await db.transaction(async (tx) => {
        const escrowRows = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.id, escrow.id))
          .limit(1);
        const claimRows = await tx
          .select()
          .from(claims)
          .where(eq(claims.id, claim.id))
          .limit(1);
        return { escrow: escrowRows[0] ?? escrow, claim: claimRows[0] ?? claim };
      });
      return { status: 'pending', escrow: toEscrowView(fresh.escrow), claim: toClaimView(fresh.claim) };
    }
    const reread = await db.transaction(async (tx) => {
      const rows = await tx.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1);
      return rows[0] ?? escrow;
    });
    if (replayConflict && reread.releaseTxHash !== broadcast.txHash) {
      throw new AppError(
        409,
        'CONFLICT',
        'This release transaction is already recorded for another escrow.',
      );
    }
    if (reread.releaseTxHash === null) {
      return { status: 'pending', escrow: toEscrowView(reread), claim: toClaimView(claim) };
    }
    releaseTxHash = reread.releaseTxHash;
  }

  let receipt: { confirmations: number } | null;
  try {
    receipt = await options.client.getTransactionReceipt(releaseTxHash);
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError || err instanceof EscrowContractUnavailableError) {
      throw releaseFailed();
    }
    throw err;
  }
  const threshold = getEscrowReleaseConfirmations();
  if (receipt === null) {
    return { status: 'pending', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
  }
  if (receipt.confirmations < threshold) {
    return {
      status: 'pending',
      confirmations: receipt.confirmations,
      escrow: toEscrowView(escrow),
      claim: toClaimView(claim),
    };
  }
  return db.transaction(async (tx) => {
    const freshEscrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrow.id))
      .for('update')
      .limit(1);
    const freshEscrow = freshEscrowRows[0];
    if (!freshEscrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    const freshClaimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, claim.id), eq(claims.buyerId, options.buyerId)))
      .for('update')
      .limit(1);
    const freshClaim = freshClaimRows[0];
    if (!freshClaim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    if (freshClaim.status === 'released') {
      return { status: 'released' as const, escrow: toEscrowView(freshEscrow), claim: toClaimView(freshClaim) };
    }
    if (freshClaim.status !== 'delivered' || freshEscrow.status !== 'delivered') {
      return { status: 'pending' as const, escrow: toEscrowView(freshEscrow), claim: toClaimView(freshClaim) };
    }
    const updatedEscrow = await tx
      .update(escrows)
      .set({ status: 'released', resolvedAt: now, updatedAt: now })
      .where(and(eq(escrows.id, freshEscrow.id), eq(escrows.status, 'delivered')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'released', updatedAt: now })
      .where(and(eq(claims.id, freshClaim.id), eq(claims.status, 'delivered')))
      .returning();
    const finalEscrow = updatedEscrow[0] ?? freshEscrow;
    const finalClaim = updatedClaim[0] ?? freshClaim;
    if (updatedClaim[0]) {
      await writeAuditEvent(tx, {
        actorUserId: options.buyerId,
        eventType: 'escrow.released',
        entityType: 'claim',
        entityId: freshClaim.id,
        requestId: options.requestId ?? null,
        metadata: { escrowId: freshEscrow.id, claimId: freshClaim.id, from: 'delivered', to: 'released' },
      });
      return { status: 'released' as const, escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
    }
    return { status: 'pending' as const, escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
  });
}

function refundFailed(): AppError {
  return new AppError(
    503,
    'ESCROW_REFUND_FAILED',
    'Refund is temporarily unavailable. Please try again.',
  );
}

/** Escrow states that a read may advance. Everything else is returned as-is. */
const TRANSITION_ELIGIBLE_STATUSES = new Set(['funded', 'refunding', 'releasing']);

/**
 * Read-path gate: run checkEscrowTransitions only when the row is in a
 * transition-eligible state. A due transition with no chain client fails
 * closed (503) instead of silently returning a stale row; non-eligible
 * states never touch the chain, so reads keep working when the RPC is down.
 */
export async function maybeAdvanceEscrow(
  db: Db,
  escrow: EscrowRow,
  options: { client?: EscrowContractClient; now?: Date; requestId?: string | null },
): Promise<EscrowRow> {
  if (!TRANSITION_ELIGIBLE_STATUSES.has(escrow.status)) {
    return escrow;
  }
  if (!options.client) {
    throw new AppError(
      503,
      'ESCROW_CONTRACT_UNAVAILABLE',
      'Escrow status is temporarily unavailable. Please try again.',
    );
  }
  return checkEscrowTransitions(db, {
    escrowId: escrow.id,
    client: options.client,
    now: options.now,
    requestId: options.requestId,
  });
}

/**
 * Lazy escrow state machine, called on every escrow read (buyer/provider
 * GET /escrow, admin list). No worker or cron exists — eventual consistency
 * requires a read. Three behaviors by state; everything else is a no-op:
 *
 * - funded + delivery_deadline past: conditional funded → refunding wins
 *   exactly one broadcaster; the winner broadcasts refund(), stores
 *   refund_tx_hash, and writes the escrow.refunding audit (reason
 *   delivery_timeout). Broadcast failure compensates back to funded and
 *   surfaces 503 ESCROW_REFUND_FAILED — no partial state.
 * - refunding + refund_tx_hash: receipt confirmations ≥
 *   ESCROW_REFUND_CONFIRMATIONS flip escrow → refunded (resolved_at) and
 *   claim escrow_funded → refunded with an escrow.refunded audit.
 * - releasing + release_tx_hash: same pattern with
 *   ESCROW_RELEASE_CONFIRMATIONS; claim disputed → released with an
 *   escrow.released audit.
 *
 * Returns the row's current (possibly advanced) state. Concurrent callers
 * fail closed into the winner's state: exactly one broadcast, one
 * transition, one audit per movement.
 */
export async function checkEscrowTransitions(
  db: Db,
  options: { escrowId: string; client: EscrowContractClient; now?: Date; requestId?: string | null },
): Promise<EscrowRow> {
  const now = options.now ?? new Date();
  const rows = await db.select().from(escrows).where(eq(escrows.id, options.escrowId)).limit(1);
  const escrow = rows[0];
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  if (escrow.status === 'funded') {
    return advanceFundedToRefunding(db, escrow, options.client, now, options.requestId ?? null);
  }
  if (escrow.status === 'refunding') {
    return advanceRefundingToRefunded(db, escrow, options.client, now, options.requestId ?? null);
  }
  if (escrow.status === 'releasing') {
    return advanceReleasingToReleased(db, escrow, options.client, now, options.requestId ?? null);
  }
  return escrow;
}

async function loadClaimForEscrow(db: Db, escrow: EscrowRow) {
  const claimRows = await db.select().from(claims).where(eq(claims.id, escrow.claimId)).limit(1);
  return claimRows[0] ?? null;
}

async function advanceFundedToRefunding(
  db: Db,
  escrow: EscrowRow,
  client: EscrowContractClient,
  now: Date,
  requestId: string | null,
): Promise<EscrowRow> {
  if (!escrow.deliveryDeadline || escrow.deliveryDeadline.getTime() >= now.getTime()) {
    return escrow;
  }
  if (!escrow.onChainEscrowId) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  const claim = await loadClaimForEscrow(db, escrow);
  if (!claim || claim.status !== 'escrow_funded') {
    return escrow;
  }
  const won = await db.transaction(async (tx) => {
    const moved = await tx
      .update(escrows)
      .set({ status: 'refunding', updatedAt: now })
      .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'funded')))
      .returning({ id: escrows.id });
    return moved.length > 0;
  });
  if (!won) {
    const reread = await db.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1);
    return reread[0] ?? escrow;
  }
  let broadcast: { txHash: string };
  try {
    broadcast = await client.refund(escrow.onChainEscrowId);
  } catch (err) {
    // Compensate: back to funded so the next read retries, no partial state.
    await db.transaction(async (tx) => {
      await tx
        .update(escrows)
        .set({ status: 'funded', updatedAt: now })
        .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'refunding')));
    });
    if (err instanceof EscrowSignerUnavailableError || err instanceof EscrowContractUnavailableError) {
      throw refundFailed();
    }
    throw err;
  }
  try {
    await db.transaction(async (tx) => {
      const stored = await tx
        .update(escrows)
        .set({ refundTxHash: broadcast.txHash, updatedAt: now })
        .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'refunding')))
        .returning();
      if (!stored[0]) {
        throw new AppError(409, 'CONFLICT', 'This escrow changed while the refund was submitted.');
      }
      await writeAuditEvent(tx, {
        actorUserId: escrow.buyerId,
        eventType: 'escrow.refunding',
        entityType: 'claim',
        entityId: escrow.claimId,
        requestId,
        metadata: {
          escrowId: escrow.id,
          claimId: escrow.claimId,
          from: 'funded',
          to: 'refunding',
          reason: 'delivery_timeout',
          txHash: broadcast.txHash,
        },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'CONFLICT', 'This refund transaction is already recorded for another escrow.');
    }
    throw err;
  }
  const fresh = await db.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1);
  return fresh[0] ?? escrow;
}

async function pollReceiptOr503(
  client: EscrowContractClient,
  txHash: string,
  failed: () => AppError,
): Promise<{ confirmations: number } | null> {
  try {
    return await client.getTransactionReceipt(txHash);
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError || err instanceof EscrowContractUnavailableError) {
      throw failed();
    }
    throw err;
  }
}

async function advanceRefundingToRefunded(
  db: Db,
  escrow: EscrowRow,
  client: EscrowContractClient,
  now: Date,
  requestId: string | null,
): Promise<EscrowRow> {
  if (!escrow.refundTxHash) {
    return escrow;
  }
  const receipt = await pollReceiptOr503(client, escrow.refundTxHash, refundFailed);
  if (receipt === null || receipt.confirmations < getEscrowRefundConfirmations()) {
    return escrow;
  }
  const final = await db.transaction(async (tx) => {
    const freshEscrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrow.id))
      .for('update')
      .limit(1);
    const freshEscrow = freshEscrowRows[0];
    if (!freshEscrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    const freshClaimRows = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, escrow.claimId))
      .for('update')
      .limit(1);
    const freshClaim = freshClaimRows[0];
    if (!freshClaim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    // Two entry paths converge here: lazy auto-refund (claim escrow_funded)
    // and admin-resolve refund (claim disputed). Anything else is a stuck
    // pair — return without writing.
    if (freshEscrow.status !== 'refunding' || (freshClaim.status !== 'escrow_funded' && freshClaim.status !== 'disputed')) {
      return freshEscrow;
    }
    const updated = await tx
      .update(escrows)
      .set({ status: 'refunded', resolvedAt: now, updatedAt: now })
      .where(and(eq(escrows.id, freshEscrow.id), eq(escrows.status, 'refunding')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'refunded', updatedAt: now })
      .where(and(eq(claims.id, freshClaim.id), inArray(claims.status, ['escrow_funded', 'disputed'])))
      .returning();
    const finalEscrow = updated[0] ?? freshEscrow;
    if (updatedClaim[0]) {
      await writeAuditEvent(tx, {
        actorUserId: escrow.buyerId,
        eventType: 'escrow.refunded',
        entityType: 'claim',
        entityId: freshClaim.id,
        requestId,
        metadata: { escrowId: freshEscrow.id, claimId: freshClaim.id, from: freshClaim.status, to: 'refunded' },
      });
    }
    return finalEscrow;
  });
  return final;
}

async function advanceReleasingToReleased(
  db: Db,
  escrow: EscrowRow,
  client: EscrowContractClient,
  now: Date,
  requestId: string | null,
): Promise<EscrowRow> {
  if (!escrow.releaseTxHash) {
    return escrow;
  }
  const receipt = await pollReceiptOr503(client, escrow.releaseTxHash, releaseFailed);
  if (receipt === null || receipt.confirmations < getEscrowReleaseConfirmations()) {
    return escrow;
  }
  const final = await db.transaction(async (tx) => {
    const freshEscrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrow.id))
      .for('update')
      .limit(1);
    const freshEscrow = freshEscrowRows[0];
    if (!freshEscrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
    }
    const freshClaimRows = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, escrow.claimId))
      .for('update')
      .limit(1);
    const freshClaim = freshClaimRows[0];
    if (!freshClaim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    // Admin-release path only: the confirm-receipt (delivered → released)
    // path keeps its own release_tx_hash IS NULL guard and never enters
    // the releasing state.
    if (freshEscrow.status !== 'releasing' || freshClaim.status !== 'disputed') {
      return freshEscrow;
    }
    const updated = await tx
      .update(escrows)
      .set({ status: 'released', resolvedAt: now, updatedAt: now })
      .where(and(eq(escrows.id, freshEscrow.id), eq(escrows.status, 'releasing')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'released', updatedAt: now })
      .where(and(eq(claims.id, freshClaim.id), eq(claims.status, 'disputed')))
      .returning();
    const finalEscrow = updated[0] ?? freshEscrow;
    if (updatedClaim[0]) {
      await writeAuditEvent(tx, {
        actorUserId: escrow.buyerId,
        eventType: 'escrow.released',
        entityType: 'claim',
        entityId: freshClaim.id,
        requestId,
        metadata: { escrowId: freshEscrow.id, claimId: freshClaim.id, from: 'disputed', to: 'released' },
      });
    }
    return finalEscrow;
  });
  return final;
}

export type DisputeStatus = 'pending' | 'disputed';

export interface DisputeResult {
  status: DisputeStatus;
  disputeInstruction?: DisputeInstruction;
  escrow: EscrowView;
  claim: ClaimView;
}

/**
 * Buyer dispute: one endpoint, two behaviors. The buyer calls the contract's
 * dispute(escrowId) from their own wallet (the server never broadcasts it);
 * this endpoint hands them the call instruction until the on-chain Disputed
 * event becomes visible, then flips both rows to disputed in one
 * transaction. Idempotent: already-disputed returns 200 no-op. No state
 * change on the pending path.
 */
export async function dispute(
  db: Db,
  options: {
    claimId: string;
    buyerId: string;
    client: EscrowContractClient;
    now?: Date;
    requestId?: string | null;
  },
): Promise<DisputeResult> {
  const now = options.now ?? new Date();
  const loaded = await db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.id, options.claimId), eq(claims.buyerId, options.buyerId)))
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    const escrowRows = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.claimId, claim.id))
      .limit(1);
    return { claim, escrow: escrowRows[0] ?? null };
  });
  const { claim, escrow } = loaded;
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
  }
  if (claim.status === 'disputed' && escrow.status === 'disputed') {
    return { status: 'disputed', escrow: toEscrowView(escrow), claim: toClaimView(claim) };
  }
  if (claim.status !== 'delivered' || escrow.status !== 'delivered') {
    throw new AppError(409, 'CLAIM_NOT_PAYABLE', 'This claim cannot be disputed right now.');
  }
  if (!escrow.disputeWindowEnds) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  if (now.getTime() > escrow.disputeWindowEnds.getTime()) {
    throw new AppError(409, 'ESCROW_DISPUTE_WINDOW_CLOSED', 'The dispute window for this escrow has closed.');
  }
  if (!escrow.onChainEscrowId) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  let event;
  try {
    event = await options.client.getDisputeEvent(escrow.onChainEscrowId);
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw new AppError(
        503,
        'ESCROW_CONTRACT_UNAVAILABLE',
        'Dispute status is temporarily unavailable. Please try again.',
      );
    }
    throw err;
  }
  if (!event) {
    let instruction: DisputeInstruction;
    try {
      instruction = disputeCallData(escrow.onChainEscrowId, escrow.contractAddress ?? undefined);
    } catch (err) {
      if (err instanceof EscrowContractUnavailableError) {
        throw new AppError(
          503,
          'ESCROW_CONTRACT_UNAVAILABLE',
          'Dispute status is temporarily unavailable. Please try again.',
        );
      }
      throw err;
    }
    return {
      status: 'pending',
      disputeInstruction: instruction,
      escrow: toEscrowView(escrow),
      claim: toClaimView(claim),
    };
  }
  return db.transaction(async (tx) => {
    const updatedEscrow = await tx
      .update(escrows)
      .set({ status: 'disputed', disputedAt: now, updatedAt: now })
      .where(and(eq(escrows.id, escrow.id), eq(escrows.status, 'delivered')))
      .returning();
    const updatedClaim = await tx
      .update(claims)
      .set({ status: 'disputed', updatedAt: now })
      .where(and(eq(claims.id, claim.id), eq(claims.status, 'delivered')))
      .returning();
    const finalEscrow = updatedEscrow[0] ?? escrow;
    const finalClaim = updatedClaim[0] ?? claim;
    if (updatedClaim[0]) {
      await writeAuditEvent(tx, {
        actorUserId: options.buyerId,
        eventType: 'escrow.disputed',
        entityType: 'claim',
        entityId: claim.id,
        requestId: options.requestId ?? null,
        metadata: { escrowId: escrow.id, claimId: claim.id, from: 'delivered', to: 'disputed' },
      });
      return { status: 'disputed' as const, escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
    }
    // Lost a race: the winner flipped both rows — re-read their state
    // instead of returning our stale pre-read views.
    const reEscrow = (
      await tx.select().from(escrows).where(eq(escrows.id, escrow.id)).limit(1)
    )[0];
    const reClaim = (
      await tx.select().from(claims).where(eq(claims.id, claim.id)).limit(1)
    )[0];
    return {
      status: 'disputed' as const,
      escrow: toEscrowView(reEscrow ?? finalEscrow),
      claim: toClaimView(reClaim ?? finalClaim),
    };
  });
}
