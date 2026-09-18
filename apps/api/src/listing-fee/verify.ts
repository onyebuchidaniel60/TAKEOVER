// Phase 14g-1: NIM listing-fee verification predicate. Thin wrapper over the
// Phase 8 assessTransaction predicate (which is NOT modified here) with
// fee-specific expected terms: the recipient is the receive-only TAKEOVER
// fee wallet, the amount is the pinned LISTING_FEE_NIM converted to Luna,
// and the data binds the slot id ("TAKEOVER:fee:v1:<slotId>" — note the
// `fee` segment, distinct from the claim binding "TAKEOVER:v1:<claimId>").
//
// Deliberately NOT checked: the sender. Who physically sent the NIM is
// irrelevant — the data binding uniquely ties the payment to the slot, the
// slot owner is authenticated at publish time, and the hash UNIQUE
// constraint stops reuse. (The sender check produced false positives and
// was removed; see the fee-fix checkpoint.)
//
// Pure: no DB, no RPC, no env reads. The caller supplies the chain record
// (null when the hash is unknown) and maps the outcome to AppError codes.
import { assessTransaction, type VerificationMismatch } from '../payments/verify';
import type { TxRecord } from '../payments/rpc';

export type ListingFeeStatus = 'verified' | 'review' | 'pending';

export type ListingFeeReason = VerificationMismatch | 'not-found' | 'under-confirmed';

export interface ExpectedListingFee {
  /** TAKEOVER_FEE_WALLET_ADDRESS (canonical NQ…). Receive-only. */
  recipient: string;
  /** LISTING_FEE_NIM converted to Luna via nimToBaseUnits (decimal string). */
  amountLuna: string;
  /** Exact binding "TAKEOVER:fee:v1:<slotId>". */
  data: string;
}

export interface ListingFeeAssessment {
  status: ListingFeeStatus;
  confirmations: number | null;
  reason?: ListingFeeReason;
}

/**
 * Exact on-chain binding between a fee payment and its slot. Stored nowhere;
 * recomputed from the slot id on every attempt (stateless verification).
 */
export function expectedFeeDataForSlot(slotId: string): string {
  return `TAKEOVER:fee:v1:${slotId}`;
}

/**
 * Normalize a client-supplied fee transaction hash: strip an optional `0x`
 * prefix, lowercase. Returns null when the shape is wrong (Nimiq hashes are
 * 32 bytes = 64 hex chars, no prefix — the wallet returns exactly that).
 * The service maps null to 400 PAYMENT_INVALID_TX.
 */
export function normalizeFeeHash(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }
  return hex.toLowerCase();
}

/**
 * Diagnostic fields for one failed fee verification. Every value is public
 * chain data or an already-public identifier (slot id, wallet addresses,
 * amounts, data binding) — safe to log. Never add secrets, session
 * material, or request bodies here (source-scan hygiene guards enforce it).
 */
export interface ListingFeeErrorDetails {
  slotId: string;
  txHash: string;
  reason: string;
  confirmations: number | null;
  expectedRecipient: string;
  actualRecipient: string | null;
  expectedAmount: string;
  actualAmount: string | null;
  expectedData: string;
  actualData: string | null;
}

/**
 * Single-line diagnostic for the fee-verify failure path, prefixed with a
 * grep marker ([listing-fee-error], mirroring the [escrow-*-error]
 * convention). Pure — the caller (slots/lifecycle.ts) emits it via the
 * fd-2 error stream on every non-verified assessment.
 */
export function listingFeeErrorLine(details: ListingFeeErrorDetails): string {
  return `[listing-fee-error] ${JSON.stringify(details)}`;
}

/**
 * Assess one on-chain transaction against the expected fee terms. The sender
 * is intentionally NOT compared: the looked-up record's own sender is fed
 * back as the expected sender (self-consistent, never mismatches), so the
 * shared predicate still checks recipient, amount, data, confirmations,
 * and hash exactly as before. The hash assert is likewise fed the record's
 * own hash: the record was fetched BY the submitted hash, so identity is
 * established by the lookup itself (same standing note as the claim flow,
 * where the RPC client echoes the query hash). A null record means "chain
 * has no such transaction yet" → pending/not-found (the service maps it to
 * PAYMENT_NOT_FOUND); a found-but-under-confirmed record → pending/
 * under-confirmed (the service maps it to PAYMENT_NOT_CONFIRMED).
 */
export function assessListingFee(
  tx: TxRecord | null,
  expected: ExpectedListingFee,
): ListingFeeAssessment {
  if (tx === null) {
    return { status: 'pending', confirmations: null, reason: 'not-found' };
  }
  const assessment = assessTransaction(tx, {
    hash: tx.hash,
    sender: tx.sender,
    recipient: expected.recipient,
    amount: expected.amountLuna,
    data: expected.data,
  });
  if (assessment.outcome === 'verified') {
    return { status: 'verified', confirmations: assessment.confirmations };
  }
  if (assessment.outcome === 'pending') {
    return {
      status: 'pending',
      confirmations: assessment.confirmations,
      reason: 'under-confirmed',
    };
  }
  return {
    status: 'review',
    confirmations: assessment.confirmations,
    reason: assessment.mismatch,
  };
}
