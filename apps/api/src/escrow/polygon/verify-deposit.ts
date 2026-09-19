// 2 Completion: pure deposit-verification predicate. No DB, no network.
//
// Compares a decoded on-chain Deposited event against the server's expected
// terms: escrowId and exact amount only. Never verifies on incomplete data:
// a null event is pending, any field mismatch is a typed mismatch (never
// matched).
//
// Buyer-binding decision (model B, owner-decided): the on-chain `buyer`
// field (an EVM address recorded by the contract for refund routing) is NOT
// verified here against users.wallet_address (a Nimiq address) — that
// comparison is impossible across chains and can never succeed in
// production. The escrowId is the capability: server-generated 32-byte
// random, returned only to the authenticated buyer, single-deposit-per-
// escrowId enforced on-chain with an exact-amount check.
import type { DepositedEvent } from '../../../../../packages/shared/src/escrow/contract';

export type DepositAssessment =
  | { status: 'pending' }
  | { status: 'matched' }
  | { status: 'mismatch'; reason: 'amount' | 'escrow_id' };

export interface ExpectedDeposit {
  onChainEscrowId: string;
  amountBaseUnits: bigint;
}

/** Canonicalize a bytes32 escrow id for comparison (0x hex, case-insensitive). */
export function canonicalizeEscrowId(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input.trim().toLowerCase();
}

/**
 * Assess a decoded deposit event against expected terms, in the locked order:
 * 1. event === null → pending.
 * 2. escrowId mismatch → mismatch(escrow_id).
 * 3. amount mismatch (exact bigint) → mismatch(amount).
 * 4. Otherwise → matched.
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
  if (event.amountBaseUnits !== expected.amountBaseUnits) {
    return { status: 'mismatch', reason: 'amount' };
  }
  return { status: 'matched' };
}
