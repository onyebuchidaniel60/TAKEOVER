// Phase 6: buyer-facing claim projection (snake_case). A buyer only ever sees
// their own claims, so buyer_id is safe here. No payment fields in this phase.
import type { claims } from '../../../../db/schema';

type ClaimRow = typeof claims.$inferSelect;

export interface ClaimView {
  id: string;
  slot_id: string;
  buyer_id: string;
  quantity: number;
  status: string;
  hold_expires_at: string;
  claimed_at: string;
  updated_at: string;
}

/** Project a claims row onto the locked buyer shape. */
export function toClaimView(row: ClaimRow): ClaimView {
  return {
    id: row.id,
    slot_id: row.slotId,
    buyer_id: row.buyerId,
    quantity: row.quantity,
    status: row.status,
    hold_expires_at: row.holdExpiresAt.toISOString(),
    claimed_at: row.claimedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// Phase 9: provider-facing claim projection. The provider sees their slot's
// demand with a TRUNCATED buyer identifier only — never the full wallet,
// never tx hashes, never payment-intent fields, never buyer/slot foreign ids.
export interface ProviderSlotClaimView {
  id: string;
  quantity: number;
  status: string;
  claimed_at: string;
  hold_expires_at: string;
  updated_at: string;
  buyerDisplay: string;
}

/** Project a claims row onto the locked provider shape. */
export function toProviderSlotClaimView(row: ClaimRow, buyerDisplay: string): ProviderSlotClaimView {
  return {
    id: row.id,
    quantity: row.quantity,
    status: row.status,
    claimed_at: row.claimedAt.toISOString(),
    hold_expires_at: row.holdExpiresAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    buyerDisplay,
  };
}
