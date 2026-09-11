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
