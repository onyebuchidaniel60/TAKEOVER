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
  // Phase 14d-4: one-way provider contact note. Buyer surfaces pass the
  // gated value explicitly; provider and list views keep the default null
  // (the provider reads the note from their slot owner projection instead).
  provider_contact_note: string | null;
}

/** Project a claims row onto the locked buyer shape. */
export function toClaimView(row: ClaimRow, providerContactNote: string | null = null): ClaimView {
  return {
    id: row.id,
    slot_id: row.slotId,
    buyer_id: row.buyerId,
    quantity: row.quantity,
    status: row.status,
    hold_expires_at: row.holdExpiresAt.toISOString(),
    claimed_at: row.claimedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    provider_contact_note: providerContactNote,
  };
}

// Phase 14d-4: buyer visibility gate for the provider contact note. The note
// is visible only once money is committed — funded-side escrow statuses.
// `releasing` (path to released) is visible; `refunding` (path to refunded)
// is hidden. No escrow row at all means hidden (callers pass null).
const CONTACT_NOTE_VISIBLE_ESCROW_STATUSES = new Set([
  'funded',
  'delivered',
  'disputed',
  'releasing',
  'released',
]);

/** Pure gate: is the contact note visible to the buyer at this escrow status? */
export function isContactNoteVisibleToBuyer(escrowStatus: string): boolean {
  return CONTACT_NOTE_VISIBLE_ESCROW_STATUSES.has(escrowStatus);
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
