// Phase 14d-2: pure deposit-verification predicate. No DB, no network.
//
// Compares a decoded on-chain Deposited event against the server's expected
// terms. Never verifies on incomplete data: a null event is pending, any
// field mismatch is a typed mismatch (never matched).
//
// Field-name note: packages/shared/src/escrow/contract.ts names the buyer
// field `participant` (shared across Deposited/Released/Refunded/Disputed);
// the phase brief calls it `buyer`. This predicate accepts both shapes and
// compares the single buyer/participant value against expected.buyerWallet.
import type { DepositedEvent } from '../../../../../packages/shared/src/escrow/contract';

export type DepositAssessment =
  | { status: 'pending' }
  | { status: 'matched' }
  | { status: 'mismatch'; reason: 'amount' | 'buyer' | 'escrow_id' };

export interface ExpectedDeposit {
  onChainEscrowId: string;
  buyerWallet: string;
  amountBaseUnits: bigint;
}

type EventBuyerShape = {
  buyer?: unknown;
  participant?: unknown;
};

/**
 * Canonicalize a wallet for comparison: strip whitespace (including the
 * Nimiq spaced form), lowercase (Ethereum checksum vs lowercase, Nimiq
 * uppercase vs lowercase). Comparison is case- and space-insensitive so the
 * same address in any accepted textual form matches; different addresses
 * never match. Empty results stay empty so callers fail closed.
 *
 * IMPLEMENTATION DETAIL — AGENT MAY DECIDE: single generic normalizer for
 * both Nimiq and Polygon textual forms (the spec mandates canonicalized
 * comparison without pinning a format-specific canonicalizer here).
 */
export function canonicalizeDepositWallet(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input.replace(/\s+/g, '').toLowerCase();
}

/** Canonicalize a bytes32 escrow id for comparison (0x hex, case-insensitive). */
export function canonicalizeEscrowId(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().toLowerCase();
}

function eventBuyerOf(event: DepositedEvent): unknown {
  const shaped = event as unknown as EventBuyerShape;
  if (typeof shaped.buyer === 'string' && shaped.buyer.length > 0) {
    return shaped.buyer;
  }
  return shaped.participant;
}

/**
 * Assess a decoded deposit event against expected terms, in the locked order:
 * 1. event === null → pending.
 * 2. escrowId mismatch → mismatch(escrow_id).
 * 3. buyer mismatch (canonicalized) → mismatch(buyer).
 * 4. amount mismatch (exact bigint) → mismatch(amount).
 * 5. Otherwise → matched.
 */
export function assessDeposit(
  event: DepositedEvent | null,
  expected: ExpectedDeposit,
): DepositAssessment {
  if (event === null) {
    return { status: 'pending' };
  }
  if (canonicalizeEscrowId(event.escrowId) !== canonicalizeEscrowId(expected.onChainEscrowId)) {
    return { status: 'mismatch', reason: 'escrow_id' };
  }
  if (
    canonicalizeDepositWallet(eventBuyerOf(event)) !==
    canonicalizeDepositWallet(expected.buyerWallet)
  ) {
    return { status: 'mismatch', reason: 'buyer' };
  }
  if (event.amountBaseUnits !== expected.amountBaseUnits) {
    return { status: 'mismatch', reason: 'amount' };
  }
  return { status: 'matched' };
}
