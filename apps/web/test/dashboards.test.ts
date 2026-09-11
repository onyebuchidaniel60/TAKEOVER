// Phase 9 frontend tests — no backend, no wallet. Covers the auth
// return-target helper, claim bucket grouping, and wallet truncation.
import { describe, expect, it } from 'vitest';
import { getReturnTo } from '../src/components/RequireAuth';
import {
  groupClaimsForBuckets,
  truncateWalletAddress,
  type ClaimView,
} from '../src/lib/slots';

describe('getReturnTo', () => {
  it('returns the preserved destination for a bounced guest', () => {
    expect(getReturnTo({ from: '/sell/abc' }, '/')).toBe('/sell/abc');
    expect(getReturnTo({ from: '/claims?page=2' }, '/')).toBe('/claims?page=2');
  });

  it('rejects missing, non-string, external, and self targets', () => {
    expect(getReturnTo(null, '/')).toBeNull();
    expect(getReturnTo({}, '/')).toBeNull();
    expect(getReturnTo({ from: 42 }, '/')).toBeNull();
    expect(getReturnTo({ from: 'https://evil.example/' }, '/')).toBeNull();
    expect(getReturnTo({ from: '//evil.example/' }, '/')).toBeNull();
    expect(getReturnTo({ from: '/' }, '/')).toBeNull();
  });
});

describe('groupClaimsForBuckets', () => {
  function claim(id: string, status: string): ClaimView {
    return {
      id,
      slot_id: 'slot-1',
      buyer_id: 'buyer-1',
      quantity: 1,
      status,
      hold_expires_at: new Date().toISOString(),
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  it('groups every status into its bucket in display order', () => {
    const buckets = groupClaimsForBuckets([
      claim('e1', 'expired'),
      claim('p1', 'paid'),
      claim('a1', 'active_hold'),
      claim('r1', 'payment_review'),
      claim('w1', 'payment_pending'),
      claim('c1', 'cancelled'),
    ]);
    expect(buckets.map((b) => b.key)).toEqual(['active', 'pending', 'review', 'paid', 'ended']);
    expect(buckets[0]?.claims.map((c) => c.id)).toEqual(['a1']);
    expect(buckets[1]?.claims.map((c) => c.id)).toEqual(['w1']);
    expect(buckets[2]?.claims.map((c) => c.id)).toEqual(['r1']);
    expect(buckets[3]?.claims.map((c) => c.id)).toEqual(['p1']);
    expect(buckets[4]?.claims.map((c) => c.id)).toEqual(['e1', 'c1']);
  });

  it('returns empty buckets with helper text when there is nothing to show', () => {
    const buckets = groupClaimsForBuckets([]);
    expect(buckets).toHaveLength(5);
    for (const bucket of buckets) {
      expect(bucket.claims).toEqual([]);
      expect(bucket.emptyText.length).toBeGreaterThan(0);
    }
  });
});

describe('truncateWalletAddress (web)', () => {
  it('mirrors the server display format', () => {
    expect(truncateWalletAddress('NQ0700000000000000000000000000000000')).toBe('NQ07…0000');
    expect(truncateWalletAddress('short')).toBe('SHORT');
  });
});
