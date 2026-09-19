// Owner slot projection. The provider's own slots expose everything
// the public projection has, plus the provider contact note they set. Still
// never provider_id or other internal columns.
// (The NIM-era payout_wallet field was removed here: the USDT escrow flow
// collects the provider payout address at mark-delivered time instead.)
// Plus provider_contact_note, so the provider can see the note
// they set. The public projection never carries it.
import type { slots } from '../../../../db/schema';
import { toPublicSlot, type PublicSlot } from './public-slot';

type SlotRow = typeof slots.$inferSelect;

export interface OwnerSlot extends PublicSlot {
  provider_contact_note: string | null;
}

/** Project a slots row onto the locked owner shape. */
export function toOwnerSlot(row: SlotRow, providerDisplay: string): OwnerSlot {
  return {
    ...toPublicSlot(row, providerDisplay),
    provider_contact_note: row.providerContactNote,
  };
}
