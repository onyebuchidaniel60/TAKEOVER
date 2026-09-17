// Phase 14g-1: NIM listing-fee verification predicate. Thin wrapper over the
// Phase 8 assessTransaction predicate (which is NOT modified here) with
// fee-specific expected terms: the sender is the slot owner's wallet, the
// recipient is the receive-only TAKEOVER fee wallet, the amount is the
// pinned LISTING_FEE_NIM converted to Luna, and the data binds the slot id
// ("TAKEOVER:fee:v1:<slotId>" — note the `fee` segment, distinct from the
// claim binding "TAKEOVER:v1:<claimId>").
//
// Pure: no DB, no RPC, no env reads. The caller supplies the chain record
// (null when the hash is unknown) and maps the outcome to AppError codes.
import { assessTransaction, type VerificationMismatch } from '../payments/verify';
import type { TxRecord } from '../payments/rpc';

export type ListingFeeStatus = 'verified' | 'review' | 'pending';

export type ListingFeeReason = VerificationMismatch | 'not-found' | 'under-confirmed';

export interface ExpectedListingFee {
  /** Slot owner's authenticated wallet (canonical NQ…). */
  sender: string;
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
 * Assess one on-chain transaction against the expected fee terms. The hash
 * assert inside assessTransaction is fed the looked-up record's own hash:
 * the record was fetched BY the submitted hash, so identity is established
 * by the lookup itself (same standing note as the claim flow, where the RPC
 * client echoes the query hash). A null record means "chain has no such
 * transaction yet" → pending/not-found (the service maps it to
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
    sender: expected.sender,
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
