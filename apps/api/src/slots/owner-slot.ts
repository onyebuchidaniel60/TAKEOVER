// Phase 5: owner slot projection. The provider's own slots expose everything
// the public projection has, plus payout_wallet. Still never provider_id or
// other internal columns.
// Phase 14d-4: plus provider_contact_note, so the provider can see the note
// they set. The public projection never carries it.
import type { slots } from '../../../../db/schema';
import { toPublicSlot, type PublicSlot } from './public-slot';

type SlotRow = typeof slots.$inferSelect;

export interface OwnerSlot extends PublicSlot {
  payout_wallet: string;
  provider_contact_note: string | null;
}

/** Project a slots row onto the locked owner shape. */
export function toOwnerSlot(row: SlotRow, providerDisplay: string): OwnerSlot {
  return {
    ...toPublicSlot(row, providerDisplay),
    payout_wallet: row.payoutWallet,
    provider_contact_note: row.providerContactNote,
  };
}
