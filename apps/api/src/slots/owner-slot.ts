// Phase 5: owner slot projection. The provider's own slots expose everything
// the public projection has, plus payout_wallet. Still never provider_id or
// other internal columns.
import type { slots } from '../../../../db/schema';
import { toPublicSlot, type PublicSlot } from './public-slot';

type SlotRow = typeof slots.$inferSelect;

export interface OwnerSlot extends PublicSlot {
  payout_wallet: string;
}

/** Project a slots row onto the locked owner shape. */
export function toOwnerSlot(row: SlotRow, providerDisplay: string): OwnerSlot {
  return { ...toPublicSlot(row, providerDisplay), payout_wallet: row.payoutWallet };
}
