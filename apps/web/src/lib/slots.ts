// Phase 4: public marketplace API client. No wallet, no Nimiq SDK here —
// discovery is public and read-only.
import { apiFetch } from './api';

// Mirrors the locked backend projection (snake_case). price_nim is a STRING.
// providerDisplay names the provider (profile display_name preferred,
// truncated wallet fallback) — public-safe in both forms.
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
  providerDisplay: string;
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
 * Phase 14c round 5: owner-approved fixed category list. UX layer ONLY —
 * the server still accepts any string for category, so values outside this
 * list (older rows, direct URLs) keep working and must never crash a form.
 */
export const SLOT_CATEGORIES = [
  'Restaurant / food',
  'Fitness / class',
  'Sports court',
  'Salon / service',
  'Event',
  'Other',
] as const;

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
// Phase 14e P2: plus the provider contact note (14d-4 owner projection;
// may be absent on stale mocks — callers treat undefined as null).
export interface OwnerSlot extends PublicSlot {
  payout_wallet: string;
  provider_contact_note?: string | null;
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

// Phase 14c round 3 (Fix C): client-side mirrors of the server validation
// rules. UX layer ONLY — the server remains authoritative: every rule below
// has a server-side twin (slots/validation.ts, provider-profiles/
// validation.ts), and anything the server still rejects surfaces the
// server's reason via ApiError. Each validator returns an inline message or
// null when the value passes. Do NOT add rules here the server does not
// enforce.

const NIMIQ_ADDRESS_LENGTH = 36;
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY';

function nimiqIbanMod97(body: string, check: string): number {
  const rearranged = `${body}NQ${check}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    let digits: string;
    if (code >= 48 && code <= 57) {
      digits = char;
    } else if (code >= 65 && code <= 90) {
      digits = String(code - 55);
    } else {
      return -1;
    }
    for (const digit of digits) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder;
}

/**
 * Exact client mirror of the server's canonicalizeNimiqAddress VALIDATION
 * (apps/api/src/auth/nimiq-address.ts): strip spaces, uppercase, 36 chars,
 * NQ prefix, numeric check digits, custom-base32 body, IBAN mod-97 == 1.
 * No dependencies; no derivation (only validation).
 */
export function isValidNimiqAddress(input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }
  const compact = input.replace(/ /g, '').toUpperCase();
  if (compact.length !== NIMIQ_ADDRESS_LENGTH) {
    return false;
  }
  if (!compact.startsWith('NQ')) {
    return false;
  }
  const check = compact.slice(2, 4);
  const body = compact.slice(4);
  if (!/^[0-9]{2}$/.test(check)) {
    return false;
  }
  for (const char of body) {
    if (!NIMIQ_ALPHABET.includes(char)) {
      return false;
    }
  }
  return nimiqIbanMod97(body, check) === 1;
}

/**
 * Mirrors providerProfileBodySchema exactly: trim, 2–60 chars, no links
 * (http(s):// or www. — the same two server regexes, nothing stricter, so a
 * name the client accepts is never rejected for a rule the server lacks).
 */
export function validateDisplayName(input: string): string | null {
  const value = input.trim();
  if (value.length < 2) {
    return 'Use at least 2 characters.';
  }
  if (value.length > 60) {
    return 'Keep it to 60 characters or fewer.';
  }
  if (/https?:\/\//i.test(value) || /www\./i.test(value)) {
    return 'Display name must not contain links.';
  }
  return null;
}

/** Mirrors the title rules enforced at create (non-blank) and publish. */
export function validateSlotTitle(title: string): string | null {
  if (!title.trim()) {
    return 'Give your opening a title.';
  }
  return null;
}

/**
 * Mirrors the publish gate (startsAt must be in the future). `nowMs` is a
 * test seam; production passes the current time.
 */
export function validateSlotStartsAt(startsAtIso: string | undefined, nowMs: number = Date.now()): string | null {
  if (!startsAtIso) {
    return 'Pick a valid start date and time.';
  }
  const startsAt = new Date(startsAtIso).getTime();
  if (Number.isNaN(startsAt)) {
    return 'Pick a valid start date and time.';
  }
  if (!(startsAt > nowMs)) {
    return 'Start must be in the future.';
  }
  return null;
}

/**
 * Ends is optional, but when provided it must parse and fall after the start
 * (publish gate). Pass the raw input: '' means "not provided".
 */
export function validateSlotEndsAt(
  startsAtIso: string | undefined,
  endsAtInput: string,
): string | null {
  if (!endsAtInput) {
    return null;
  }
  const endsAt = new Date(endsAtInput).getTime();
  if (Number.isNaN(endsAt)) {
    return 'Pick a valid end date and time.';
  }
  if (startsAtIso) {
    const startsAt = new Date(startsAtIso).getTime();
    if (!Number.isNaN(startsAt) && !(endsAt > startsAt)) {
      return 'End must be after the start.';
    }
  }
  return null;
}

/** Reuses the exact base-unit parser the submit path uses. */
export function validateSlotPrice(priceInput: string): string | null {
  try {
    parseNimToBaseUnits(priceInput);
  } catch (err) {
    return err instanceof Error ? err.message : 'Enter a valid price.';
  }
  return null;
}

/** Mirrors the quantity rule (whole number, at least 1). */
export function validateSlotQuantity(quantityInput: string): string | null {
  const totalQuantity = Number(quantityInput);
  if (!Number.isInteger(totalQuantity) || totalQuantity < 1) {
    return 'Spots must be a whole number of 1 or more.';
  }
  return null;
}

/**
 * Payout must be a canonical Nimiq address — publish rejects anything else,
 * so the form says so upfront instead of failing at publish time.
 */
export function validateSlotPayout(payoutInput: string): string | null {
  if (!payoutInput.trim()) {
    return 'Enter the wallet address that should receive payment.';
  }
  if (!isValidNimiqAddress(payoutInput)) {
    return 'Enter a valid Nimiq wallet address (starts with NQ).';
  }
  return null;
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

export function publishSlot(slotId: string, transactionHash?: string): Promise<{ slot: OwnerSlot }> {
  // Phase 14c round 3 (Fix A1): always send a JSON body — Fastify rejects an
  // empty body under content-type: application/json (400), which broke
  // bodyless mutations on real browsers while inject-based tests (no
  // content-type header) stayed green.
  // Phase 14g-1: optional fee hash. Omitted (not null) on the no-fee path so
  // the wire shape stays exactly {} as before.
  const body = transactionHash === undefined ? {} : { transactionHash };
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}/publish`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Phase 14g-1: NIM listing-fee terms served by GET /api/v1/config (public).
// amountNim is a decimal NIM string ("400") — Luna never reaches the UI.
export interface ListingFeeConfig {
  required: boolean;
  amountNim: string | null;
  walletAddress: string | null;
  misconfigured?: true;
}

export function fetchConfig(): Promise<{ listingFee: ListingFeeConfig }> {
  return apiFetch<{ listingFee: ListingFeeConfig }>('/api/v1/config');
}

export function cancelSlot(slotId: string): Promise<{ slot: OwnerSlot }> {
  // Same Fix A1 rationale as publishSlot above.
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/slots/${encodeURIComponent(slotId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Phase 14e P2: one-way provider contact note (14d-4). Body shape mirrors
// the server schema exactly ({ provider_contact_note: string | null } —
// null clears). Client-side length/URL checks live in ContactNoteForm (UX
// only); the server stays authoritative.
export function updateSlotContactNote(
  slotId: string,
  providerContactNote: string | null,
): Promise<{ slot: OwnerSlot }> {
  return apiFetch<{ slot: OwnerSlot }>(`/api/v1/me/slots/${encodeURIComponent(slotId)}/contact-note`, {
    method: 'PATCH',
    body: JSON.stringify({ provider_contact_note: providerContactNote }),
  });
}

// Phase 7: buyer payment-intent projection. Mirrors the locked backend shape:
// expectedAmountNim is a STRING; expected_sender is never exposed.
//
// Phase 14e P1 (partial deprecation): PaymentPanel is deleted and the USDT
// escrow loop replaces it as the active_hold writer, so the direct-payment
// submission path is dead — submitPayment and the NIM-SDK-only
// baseUnitsToSafeNumber go with it. createPaymentIntent + verifyPayment +
// the poll helpers STAY: the kept payment_pending branch (VerifyPollBox in
// ClaimDetailPage) still serves live legacy rows (5 payment_pending at the
// 14e-P3 recount, 2026-09-18). Full removal in a later phase once zero
// payment_pending rows remain (§5 gates).
export interface PaymentIntent {
  id: string;
  claimId: string;
  expectedAmountNim: string;
  expectedRecipient: string;
  expectedData: string;
  status: string;
  txHash: string | null;
  submittedAt: string | null;
  createdAt: string;
}

export function createPaymentIntent(claimId: string): Promise<{
  intent: PaymentIntent;
  claim: ClaimView;
  slot: PublicSlot;
}> {
  return apiFetch(`/api/v1/claims/${encodeURIComponent(claimId)}/payment-intent`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Phase 8: verification result projection. Mirrors the locked backend shape:
// status is verified|pending|review; confirmations appears when the chain
// reported it; reason is a client-generic code (sender/recipient/amount/data
// mismatch or timeout) — specifics stay server-side.
export interface VerificationResult {
  status: 'verified' | 'pending' | 'review';
  confirmations?: number;
  reason?: string;
}

export function verifyPayment(claimId: string): Promise<{
  intent: PaymentIntent;
  claim: ClaimView;
  verification: VerificationResult;
}> {
  return apiFetch(`/api/v1/claims/${encodeURIComponent(claimId)}/verify-payment`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Phase 8: pure poll-scheduling helper for the payment_pending screen.
// Returns the next auto-poll delay in ms, or null to stop polling.
export const VERIFY_POLL_INTERVAL_MS = 5_000;
export const VERIFY_POLL_MAX_ATTEMPTS = 60;
export const VERIFY_POLL_RPC_BACKOFF_MS = 15_000;
export const VERIFY_POLL_RATE_LIMIT_BACKOFF_MS = 10_000;

export type VerifyPollOutcome = 'verified' | 'review' | 'pending' | 'rpc-unavailable' | 'rate-limited';

export function nextVerifyPollDelayMs(
  outcome: VerifyPollOutcome,
  retryAfterMs?: number,
): number | null {
  switch (outcome) {
    case 'verified':
    case 'review':
      return null;
    case 'pending':
      return VERIFY_POLL_INTERVAL_MS;
    case 'rpc-unavailable':
      return VERIFY_POLL_RPC_BACKOFF_MS;
    case 'rate-limited':
      return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? retryAfterMs
        : VERIFY_POLL_RATE_LIMIT_BACKOFF_MS;
  }
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

// Phase 9: provider demand view for one owned slot. Mirrors the locked
// backend shape: truncated buyer identifiers only, plus exact per-status
// counts (the counts always sum to claims.length — enforced server-side).
export interface ProviderSlotClaim {
  id: string;
  quantity: number;
  status: string;
  claimed_at: string;
  hold_expires_at: string;
  updated_at: string;
  buyerDisplay: string;
}

export interface SlotClaimCounts {
  active_hold: number;
  payment_pending: number;
  paid: number;
  payment_review: number;
  expired: number;
  cancelled: number;
}

export function fetchSlotClaims(slotId: string): Promise<{
  claims: ProviderSlotClaim[];
  counts: SlotClaimCounts;
}> {
  return apiFetch(`/api/v1/me/slots/${encodeURIComponent(slotId)}/claims`);
}

// Phase 9: own profile (GET /me). providerProfile is null until the user
// sets a display name.
export interface MeUser {
  id: string;
  walletAddress: string;
  role: string;
  status: string;
  hasProviderProfile?: boolean;
  providerProfile: { displayName: string } | null;
}

export function fetchMe(): Promise<{ user: MeUser }> {
  return apiFetch<{ user: MeUser }>('/api/v1/me');
}

export function updateProviderProfile(displayName: string): Promise<{
  providerProfile: { displayName: string };
}> {
  return apiFetch('/api/v1/me/provider-profile', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  });
}

/**
 * Display-only wallet truncation, mirroring the server format (first 4 +
 * '…' + last 4 of the compacted address). Never throws; never used for
 * anything but labels.
 */
export function truncateWalletAddress(address: string): string {
  const compact = address.replace(/ /g, '').toUpperCase();
  if (compact.length <= 8) {
    return compact;
  }
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

// Phase 9: buyer claim buckets for /claims, in display order. Pure grouping
// over an already-fetched list (kept out of the component per the
// keep-logic-out-of-UI rule).
// Phase 14e P1: escrow statuses land in exactly one bucket — a dedicated
// 'escrow' bucket for live escrow claims; terminal released/refunded join
// 'ended'. Legacy buckets unchanged.
export interface ClaimBucket {
  key: 'active' | 'escrow' | 'pending' | 'review' | 'paid' | 'ended';
  title: string;
  emptyText: string;
  claims: ClaimView[];
}

/** Claim-side escrow statuses (live escrow loop). Shared with ClaimDetailPage. */
export const ESCROW_BUCKET_STATUSES = [
  'deposit_submitted',
  'escrow_funded',
  'delivered',
  'disputed',
] as const;

export function groupClaimsForBuckets(claims: ClaimView[]): ClaimBucket[] {
  const active = claims.filter((c) => c.status === 'active_hold');
  const escrow = claims.filter((c) =>
    (ESCROW_BUCKET_STATUSES as readonly string[]).includes(c.status),
  );
  const pending = claims.filter((c) => c.status === 'payment_pending');
  const review = claims.filter((c) => c.status === 'payment_review');
  const paid = claims.filter((c) => c.status === 'paid');
  const ended = claims.filter(
    (c) =>
      c.status === 'expired' ||
      c.status === 'cancelled' ||
      c.status === 'released' ||
      c.status === 'refunded',
  );
  return [
    { key: 'active', title: 'Active holds', emptyText: 'No active holds right now.', claims: active },
    { key: 'escrow', title: 'In escrow', emptyText: 'No claims in escrow right now.', claims: escrow },
    {
      key: 'pending',
      title: 'Awaiting confirmation',
      emptyText: 'No payments awaiting confirmation.',
      claims: pending,
    },
    {
      key: 'review',
      title: 'Payment under review',
      emptyText: 'No payments under review.',
      claims: review,
    },
    { key: 'paid', title: 'Paid', emptyText: 'No paid holds yet.', claims: paid },
    { key: 'ended', title: 'Ended', emptyText: 'No ended holds.', claims: ended },
  ];
}
