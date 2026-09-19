// Public slot projection. The marketplace read path exposes ONLY the
// locked fields below — never payout_wallet, provider_id, or internal columns.
// price_usdt is always a JSON string (see ./price.ts), never a JS number.
// ProviderDisplay names the provider (profile display_name preferred,
// truncated wallet fallback) — public-safe in both forms.
import type { slots } from '../../../../db/schema';
import { serializePriceUsdt } from './price';

type SlotRow = typeof slots.$inferSelect;

export interface PublicSlot {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  location_label: string | null;
  starts_at: string;
  ends_at: string | null;
  price_usdt: string;
  total_quantity: number;
  available_quantity: number;
  status: string;
  published_at: string | null;
  providerDisplay: string;
}

/** Project a slots row onto the locked public shape. Throws on invalid price. */
export function toPublicSlot(row: SlotRow, providerDisplay: string): PublicSlot {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    location_label: row.locationLabel,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt ? row.endsAt.toISOString() : null,
    price_usdt: serializePriceUsdt(row.priceUsdt),
    total_quantity: row.totalQuantity,
    available_quantity: row.availableQuantity,
    status: row.status,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    providerDisplay,
  };
}
