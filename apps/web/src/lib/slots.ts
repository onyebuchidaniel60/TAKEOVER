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

// Phase 5: owner projection — everything public plus the payout wallet.
export interface OwnerSlot extends PublicSlot {
  payout_wallet: string;
}

export interface MySlotsResponse {
  slots: OwnerSlot[];
  total: number;
  limit: number;
  offset: number;
}

export interface SlotWrite {
  title: string;
  description?: string;
  category?: string;
  location_label?: string;
  starts_at: string;
  ends_at?: string;
  price_nim: string;
  total_quantity: number;
  payout_wallet: string;
}

/**
 * Parse a human NIM amount ("1.5") into exact base-unit string ("150000").
 * At most 5 decimals (1 NIM = 100,000 base units). Throws on garbage.
 */
export function parseNimToBaseUnits(input: string): string {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Enter a price like 1.5 (up to 5 decimals).');
  }
  const whole = BigInt(match[1] ?? '0');
  const frac = (match[2] ?? '').padEnd(5, '0');
  const value = whole * BigInt(LUNA_PER_NIM) + BigInt(frac);
  if (value <= 0n) {
    throw new Error('Price must be more than 0.');
  }
  return value.toString();
}

export function fetchMySlots(params: { status?: string; limit?: number; offset?: number } = {}): Promise<MySlotsResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch<MySlotsResponse>(`/api/v1/me/slots${suffix ? `?${suffix}` : ''}`);
}

export function fetchOwnerSlot(slotId: string): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}`);
}

export function createSlot(body: SlotWrite): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>('/api/v1/slots', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateSlot(slotId: string, body: Partial<SlotWrite>): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function publishSlot(slotId: string): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}/publish`, {
    method: 'POST',
  });
}

export function cancelSlot(slotId: string): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}/cancel`, {
    method: 'POST',
  });
}

// Phase 6: buyer claim views (snake_case). No payment fields in this phase.
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

export interface MyClaimsResponse {
  claims: ClaimView[];
  total: number;
  limit: number;
  offset: number;
}

export function createClaim(slotId: string): Promise<{ claim: ClaimView; slot: PublicSlot }> {
  return apiFetch<{ claim: ClaimView; slot: PublicSlot }>(
    `/api/v1/slots/${encodeURIComponent(slotId)}/claims`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function fetchClaim(claimId: string): Promise<{ claim: ClaimView; slot: PublicSlot }> {
  return apiFetch<{ claim: ClaimView; slot: PublicSlot }>(
    `/api/v1/claims/${encodeURIComponent(claimId)}`,
  );
}

export function fetchMyClaims(
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<MyClaimsResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch<MyClaimsResponse>(`/api/v1/me/claims${suffix ? `?${suffix}` : ''}`);
}
