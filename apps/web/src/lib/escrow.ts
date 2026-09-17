// Phase 14e P1: typed client for the USDT escrow endpoints (buyer loop).
// Shapes mirror the backend projections exactly (snake_case, string
// amounts) — the backend is authoritative (ARCHITECTURE.md §13). No
// token-specific constants here except the single hardcoded rail (D8);
// the token address always arrives inside the depositInstruction (D7-B).
import { apiFetch, ApiError } from './api';
import type { ClaimView } from './slots';

export { ApiError };

/** The only escrow rail (D8). Sent literally; the server still validates it. */
export const ESCROW_TOKEN = 'USDT_POLYGON' as const;

/** Backend escrow projection (snake_case). resolution_notes is buyer-null. */
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
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** USDT deposit instruction (D7 variant B: tokenAddress served, not hardcoded). */
export interface DepositInstruction {
  contractAddress: string;
  tokenAddress: string;
  usdtAmount: string;
  onChainEscrowId: string;
  approveTo: string;
  approveAmount: string;
  buyerWallet: string;
}

export interface DisputeInstruction {
  contractAddress: string;
  onChainEscrowId: string;
  callData: string;
}

export interface EscrowIntentResult {
  escrow: EscrowView;
  claim: ClaimView;
  depositInstruction: DepositInstruction;
}

export interface EscrowSubmissionResult {
  escrow: EscrowView;
  claim: ClaimView;
}

export type VerifyDepositStatus = 'pending' | 'mismatch' | 'review' | 'funded';

export interface VerifyDepositResult {
  status: VerifyDepositStatus;
  reason?: string;
  escrow: EscrowView;
  claim: ClaimView;
}

export interface ConfirmReceiptResult {
  status: 'pending' | 'released';
  confirmations?: number;
  escrow: EscrowView;
  claim: ClaimView;
}

export interface DisputeResult {
  status: 'pending' | 'disputed';
  disputeInstruction?: DisputeInstruction;
  escrow: EscrowView;
  claim: ClaimView;
}

export interface FetchEscrowResult {
  escrow: EscrowView;
  claim: ClaimView;
}

export function createEscrowIntent(claimId: string): Promise<EscrowIntentResult> {
  return apiFetch<EscrowIntentResult>(`/api/v1/claims/${encodeURIComponent(claimId)}/escrow-intent`, {
    method: 'POST',
    body: JSON.stringify({ token: ESCROW_TOKEN }),
  });
}

export function submitDepositReference(claimId: string, transactionHash: string): Promise<EscrowSubmissionResult> {
  return apiFetch<EscrowSubmissionResult>(
    `/api/v1/claims/${encodeURIComponent(claimId)}/escrow-submission`,
    {
      method: 'POST',
      body: JSON.stringify({ transactionHash }),
    },
  );
}

export function verifyDeposit(claimId: string): Promise<VerifyDepositResult> {
  return apiFetch<VerifyDepositResult>(`/api/v1/claims/${encodeURIComponent(claimId)}/verify-deposit`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function confirmReceipt(claimId: string): Promise<ConfirmReceiptResult> {
  return apiFetch<ConfirmReceiptResult>(
    `/api/v1/claims/${encodeURIComponent(claimId)}/confirm-receipt`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function raiseDispute(claimId: string): Promise<DisputeResult> {
  return apiFetch<DisputeResult>(`/api/v1/claims/${encodeURIComponent(claimId)}/dispute`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function fetchEscrow(claimId: string): Promise<FetchEscrowResult> {
  return apiFetch<FetchEscrowResult>(`/api/v1/claims/${encodeURIComponent(claimId)}/escrow`);
}

// Poll scheduler (mirrors the nextVerifyPollDelayMs approach). Delays honor
// the server limiters: verify-deposit is per-claim 1/5 s, confirm-receipt is
// per-IP 10/60 s shared across claims.
export const VERIFY_DEPOSIT_INTERVAL_MS = 6_000;
export const VERIFY_DEPOSIT_MAX_ATTEMPTS = 60;
export const CONFIRM_RECEIPT_INTERVAL_MS = 15_000;
export const CONFIRM_RECEIPT_MAX_ATTEMPTS = 24;
export const ESCROW_RPC_BACKOFF_MS = 15_000;
export const ESCROW_RATE_LIMIT_BACKOFF_MS = 10_000;

export type EscrowPollOutcome =
  | 'working'
  | 'done'
  | 'stop'
  | 'rpc-unavailable'
  | 'rate-limited';

/**
 * Next auto-poll delay in ms, or null to stop. `done`/`stop` (terminal or
 * reason copy) halt; 503 backs off; 429 honors Retry-After.
 */
export function nextEscrowPollDelayMs(
  outcome: EscrowPollOutcome,
  baseIntervalMs: number,
  retryAfterMs?: number,
): number | null {
  switch (outcome) {
    case 'done':
    case 'stop':
      return null;
    case 'working':
      return baseIntervalMs;
    case 'rpc-unavailable':
      return ESCROW_RPC_BACKOFF_MS;
    case 'rate-limited':
      return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? retryAfterMs
        : ESCROW_RATE_LIMIT_BACKOFF_MS;
  }
}
