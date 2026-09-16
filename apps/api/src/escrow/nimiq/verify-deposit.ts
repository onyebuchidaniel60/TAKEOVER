// Phase 14f P-NIM-1: NIM escrow deposit predicate (custodial escrow).
//
// Pure assessment of one on-chain NIM transaction against the escrow row's
// server-side terms. Repurposed from the Phase 8 direct-payment predicate
// (`payments/verify.ts`, whose deprecated-path behavior is untouched):
// same check order (sender → recipient → amount → data → confirmations →
// hash), same outcome discipline (no evidence → pending; mismatch →
// mismatch with a field-level reason; under-confirmed → pending).
//
// D5 DIVERGENCE (deliberate, documented in ARCHITECTURE §6): NIM binds the
// on-chain sender to the buyer's authenticated Nimiq wallet address
// (`sender_mismatch` fails closed to review). USDT model B records the
// on-chain buyer for refund routing but never compares it — cross-chain
// identity mapping is out of MVP scope, while NIM identity and payment
// share one chain, so the comparison is free. The data binding is
// `TAKEOVER:v1:<claimId>` (deprecated-intent precedent, fits the 64-byte
// Nimiq data field, buyer-scoped); replay protection rests on the
// `deposit_tx_hash` UNIQUE backstop plus single-funding conditional
// writes, exactly as on the USDT path.
import { REQUIRED_CONFIRMATIONS, type TxRecord } from '../../payments/rpc';
import { canonicalizeTxAddress } from '../../payments/verify';

/** Data binding carried by the buyer's NIM deposit transaction. */
export function nimDepositDataBinding(claimId: string): string {
  return `TAKEOVER:v1:${claimId}`;
}

/** Server-side terms the on-chain NIM deposit is checked against. */
export interface NimDepositExpectation {
  /** Claim id driving the data binding. */
  claimId: string;
  /** Authenticated buyer Nimiq wallet (sender-bound, D5). */
  buyerWallet: string;
  /** Canonical omnibus escrow wallet (recipient). */
  escrowWallet: string;
  /** Exact escrow amount in luna base units. */
  amountBaseUnits: bigint;
  /** Submitted deposit reference the lookup was keyed on (hash assert). */
  depositTxHash: string;
}

export type NimDepositMismatch =
  | 'sender_mismatch'
  | 'recipient_mismatch'
  | 'amount_mismatch'
  | 'data_mismatch'
  | 'hash_mismatch';

export type NimDepositOutcome =
  | { status: 'pending'; confirmations?: number }
  | { status: 'mismatch'; reason: NimDepositMismatch; confirmations?: number }
  | { status: 'funded'; confirmations: number };

/**
 * Pure NIM deposit assessment. Null tx (unknown hash) → pending; field
 * failures → mismatch (never funded); under-confirmed → pending; exact
 * match at policy → funded. Never throws on chain data (malformed values
 * surface as mismatches); malformed server-side terms are a bug → throw.
 */
export function assessNimDeposit(tx: TxRecord | null, expected: NimDepositExpectation): NimDepositOutcome {
  if (tx === null) {
    return { status: 'pending' };
  }
  const expectedSender = canonicalizeTxAddress(expected.buyerWallet);
  const expectedRecipient = canonicalizeTxAddress(expected.escrowWallet);
  if (expectedSender === null || expectedRecipient === null) {
    throw new Error('Invalid NIM deposit expectation.');
  }
  const txSender = canonicalizeTxAddress(tx.sender);
  if (txSender === null || txSender !== expectedSender) {
    return { status: 'mismatch', reason: 'sender_mismatch', confirmations: tx.confirmations ?? undefined };
  }
  const txRecipient = canonicalizeTxAddress(tx.recipient);
  if (txRecipient === null || txRecipient !== expectedRecipient) {
    return { status: 'mismatch', reason: 'recipient_mismatch', confirmations: tx.confirmations ?? undefined };
  }
  let amountsEqual = false;
  try {
    amountsEqual = BigInt(tx.value) === expected.amountBaseUnits;
  } catch {
    amountsEqual = false;
  }
  if (!amountsEqual) {
    return { status: 'mismatch', reason: 'amount_mismatch', confirmations: tx.confirmations ?? undefined };
  }
  if (tx.data !== nimDepositDataBinding(expected.claimId)) {
    return { status: 'mismatch', reason: 'data_mismatch', confirmations: tx.confirmations ?? undefined };
  }
  if (tx.confirmations === null || tx.confirmations < REQUIRED_CONFIRMATIONS) {
    return { status: 'pending', confirmations: tx.confirmations ?? undefined };
  }
  if (tx.hash.toLowerCase() !== expected.depositTxHash.toLowerCase()) {
    return { status: 'mismatch', reason: 'hash_mismatch', confirmations: tx.confirmations ?? undefined };
  }
  return { status: 'funded', confirmations: tx.confirmations };
}
