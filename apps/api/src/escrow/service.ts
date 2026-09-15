// Phase 14d-2: USDT escrow service (deposit path only).
// No release/refund/dispute/delivery logic — those are 14d-3+.
//
// Pricing note: amount_base_units is snapshotted from the slot's price_nim
// (the NIM-denominated price is used as the USDT base-unit amount). This is
// the current pricing model and out of scope to change here.
//
// Buyer-binding note: expected.buyerWallet for deposit verification comes
// from users.wallet_address (the Nimiq identity). The schema carries no
// Polygon buyer column this phase (no schema changes allowed), so the
// on-chain Polygon buyer (0x…) is compared against the Nimiq wallet with a
// generic case/space-insensitive canonicalizer. Mocked-client tests use the
// same wallet string on both sides; a production Polygon-vs-Nimiq format gap
// remains and is recorded in AI_HANDOFF KNOWN ISSUES for a later phase to
// bind the Polygon buyer address explicitly.
//
// Window-timing note: claims carries no deposit_submitted_at column (no
// schema changes). The verification-window clock uses claims.updated_at as
// the deposit_submitted-entry proxy — safe because no other write occurs
// while a claim sits in deposit_submitted (submission sets it; verify moves
// it out). Labeled IMPLEMENTATION DETAIL where used.
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDb } from '../../../../db/client';
import { claims, escrows, slots, users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { getEscrowContractAddress } from './polygon/client';
import type { EscrowContractClient } from '../../../../packages/shared/src/escrow/contract';
import { getEscrowDeliveryWindowSeconds, getEscrowDepositVerificationSeconds } from '../env';
import { isUniqueViolation } from '../claims/service';
import { toClaimView, type ClaimView } from '../claims/claim-view';
import { AppError } from '../http/errors';
import { assessDeposit } from './polygon/verify-deposit';
import { EscrowContractUnavailableError } from './polygon/client';

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
  created_at: string;
  updated_at: string;
}

export interface DepositInstruction {
  contractAddress: string;
  usdtAmount: string;
  onChainEscrowId: string;
  approveTo: string;
  approveAmount: string;
  buyerWallet: string;
}

type EscrowRow = typeof escrows.$inferSelect;

function toEscrowView(row: EscrowRow): EscrowView {
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
          amountBaseUnits: slot.priceNim,
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
        .set({ status: 'deposit_submitted', updatedAt: now })
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
  reason?: 'amount' | 'buyer' | 'escrow_id' | 'timeout';
  escrow: EscrowView;
  claim: ClaimView;
}

/** True when the deposit_submitted window has elapsed (updated_at proxy — see file note). */
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
  const buyerRows = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, options.buyerId))
    .limit(1);
  const buyerWallet = buyerRows[0]?.walletAddress ?? '';
  const assessment = assessDeposit(event, {
    onChainEscrowId: escrow.onChainEscrowId,
    buyerWallet,
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
      claim.updatedAt,
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
        .set({ status: 'payment_review', updatedAt: now })
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
    }
    return { status: 'funded' as const, escrow: toEscrowView(finalEscrow), claim: toClaimView(finalClaim) };
  });
}

/** Buyer-scoped escrow read; foreign or missing claim → 404; no escrow → 404 ESCROW_NOT_FOUND. */
export async function getEscrowForBuyer(
  db: Db,
  options: { claimId: string; buyerId: string },
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
  return { escrow: toEscrowView(escrow), claim: toClaimView(claim) };
}
