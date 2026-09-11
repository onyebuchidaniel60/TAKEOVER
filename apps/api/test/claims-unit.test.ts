// Phase 6 unit tests — no database. Covers the hold TTL, the eligibility
// mirror of the claim transaction, and the hold-expiry predicate.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAIM_HOLD_TTL_SECONDS, getClaimHoldTtlSeconds } from '../src/env';
import { isClaimEligible, isHoldExpired } from '../src/claims/service';

describe('getClaimHoldTtlSeconds', () => {
  it('defaults to 900 seconds (15 minutes)', () => {
    expect(DEFAULT_CLAIM_HOLD_TTL_SECONDS).toBe(900);
    expect(getClaimHoldTtlSeconds({})).toBe(900);
  });

  it('returns a configured positive integer', () => {
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: '60' })).toBe(60);
  });

  it('falls back on blank or invalid values', () => {
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: '' })).toBe(900);
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: 'soon' })).toBe(900);
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: '0' })).toBe(900);
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: '-5' })).toBe(900);
    expect(getClaimHoldTtlSeconds({ CLAIM_HOLD_TTL_SECONDS: '1.5' })).toBe(900);
  });
});

describe('isClaimEligible', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  const future = new Date('2026-09-11T14:00:00.000Z');
  const past = new Date('2026-09-11T10:00:00.000Z');

  it('admits published and sold_out slots with future starts and stock', () => {
    expect(
      isClaimEligible({ status: 'published', startsAt: future, availableQuantity: 2 }, now),
    ).toBe(true);
    expect(
      isClaimEligible({ status: 'sold_out', startsAt: future, availableQuantity: 1 }, now),
    ).toBe(true);
  });

  it('rejects draft, cancelled, and expired slots', () => {
    for (const status of ['draft', 'cancelled', 'expired']) {
      expect(isClaimEligible({ status, startsAt: future, availableQuantity: 2 }, now)).toBe(
        false,
      );
    }
  });

  it('rejects past starts and zero stock', () => {
    expect(
      isClaimEligible({ status: 'published', startsAt: past, availableQuantity: 2 }, now),
    ).toBe(false);
    expect(
      isClaimEligible({ status: 'published', startsAt: now, availableQuantity: 2 }, now),
    ).toBe(false);
    expect(
      isClaimEligible({ status: 'published', startsAt: future, availableQuantity: 0 }, now),
    ).toBe(false);
    expect(
      isClaimEligible({ status: 'sold_out', startsAt: future, availableQuantity: 0 }, now),
    ).toBe(false);
  });
});

describe('isHoldExpired', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('expires only active holds past their deadline', () => {
    expect(
      isHoldExpired(
        { status: 'active_hold', holdExpiresAt: new Date('2026-09-11T11:59:59.000Z') },
        now,
      ),
    ).toBe(true);
  });

  it('keeps live holds, exact-deadline holds, and settled claims', () => {
    expect(
      isHoldExpired(
        { status: 'active_hold', holdExpiresAt: new Date('2026-09-11T12:00:01.000Z') },
        now,
      ),
    ).toBe(false);
    expect(isHoldExpired({ status: 'active_hold', holdExpiresAt: now }, now)).toBe(false);
    for (const status of ['expired', 'cancelled', 'payment_pending', 'paid', 'payment_review']) {
      expect(
        isHoldExpired({ status, holdExpiresAt: new Date('2026-09-11T11:00:00.000Z') }, now),
      ).toBe(false);
    }
  });
});
