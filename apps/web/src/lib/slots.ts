// Phase 4: public marketplace API client. No wallet, no Nimiq SDK here —
// discovery is public and read-only.
import { apiFetch } from './api';

// Mirrors the locked backend projection (snake_case). price_nim is a STRING.
export interface PublicSlot {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  location_label: string | null;
  starts_at: string;
  ends_at: string | null;
  price_nim: string;
  total_quantity: number;
  available_quantity: number;
  status: string;
  published_at: string | null;
}

export interface SlotsResponse {
  slots: PublicSlot[];
  total: number;
  limit: number;
  offset: number;
}

export interface SlotFilters {
  q?: string;
  category?: string;
  location?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** 1 NIM = 100,000 base units (Luna). Display conversion only. */
export const LUNA_PER_NIM = 100_000;

/**
 * Format a base-unit price string as "1.5 NIM" using exact BigInt math —
 * never floats, so large values stay precise.
 */
export function formatNim(priceNim: string): string {
  const value = BigInt(priceNim);
  const whole = value / BigInt(LUNA_PER_NIM);
  const frac = value % BigInt(LUNA_PER_NIM);
  if (frac === 0n) {
    return `${whole.toString()} NIM`;
  }
  const fracStr = frac.toString().padStart(5, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr} NIM`;
}

function toQuery(filters: SlotFilters): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.category?.trim()) params.set('category', filters.category.trim());
  if (filters.location?.trim()) params.set('location', filters.location.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters.offset === 'number') params.set('offset', String(filters.offset));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function fetchSlots(filters: SlotFilters = {}): Promise<SlotsResponse> {
  return apiFetch<SlotsResponse>(`/api/v1/slots${toQuery(filters)}`);
}

export function fetchSlot(slotId: string): Promise<{ slot: PublicSlot }> {
  return apiFetch<{ slot: PublicSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}`);
}
