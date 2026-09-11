// Phase 7 unit tests — no database. Covers intent data formatting, exact
// NIM→base-unit math, and txHash shape validation.
import { describe, expect, it } from 'vitest';
import { nimToBaseUnits } from '../src/payments/amounts';
import { expectedDataForClaim } from '../src/payments/service';
import { paymentSubmissionBodySchema } from '../src/payments/validation';

describe('expectedDataForClaim', () => {
  it('formats exactly TAKEOVER:v1:<claimId>', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(expectedDataForClaim(id)).toBe(`TAKEOVER:v1:${id}`);
  });

  it('adds no whitespace and preserves case', () => {
    const out = expectedDataForClaim('ABC');
    expect(out).toBe('TAKEOVER:v1:ABC');
    expect(out).not.toMatch(/\s/);
  });
});

describe('nimToBaseUnits', () => {
  it('converts whole NIM exactly', () => {
    expect(nimToBaseUnits('1')).toBe('100000');
    expect(nimToBaseUnits('25')).toBe('2500000');
  });

  it('converts fractional NIM exactly', () => {
    expect(nimToBaseUnits('1.5')).toBe('150000');
    expect(nimToBaseUnits('0.00001')).toBe('1');
    expect(nimToBaseUnits('0.12345')).toBe('12345');
  });

  it('stays exact past 2^53 base units', () => {
    // 9007199254740993 = 2^53 + 1: unrepresentable as a JS number, exact as a string.
    expect(nimToBaseUnits('90071992547.40993')).toBe('9007199254740993');
  });

  it('rejects garbage, zero, negatives, and excess precision', () => {
    expect(() => nimToBaseUnits('')).toThrow();
    expect(() => nimToBaseUnits('abc')).toThrow();
    expect(() => nimToBaseUnits('0')).toThrow();
    expect(() => nimToBaseUnits('0.00000')).toThrow();
    expect(() => nimToBaseUnits('-1.5')).toThrow();
    expect(() => nimToBaseUnits('1.123456')).toThrow();
    expect(() => nimToBaseUnits('1,5')).toThrow();
  });
});

describe('paymentSubmissionBodySchema', () => {
  const HASH_64 = 'ab'.repeat(32);

  it('accepts a 64-char hex hash', () => {
    expect(paymentSubmissionBodySchema.safeParse({ txHash: HASH_64 }).success).toBe(true);
  });

  it('rejects empty, non-hex, missing, oversized, and unknown fields', () => {
    expect(paymentSubmissionBodySchema.safeParse({ txHash: '' }).success).toBe(false);
    expect(paymentSubmissionBodySchema.safeParse({ txHash: 'zz top' }).success).toBe(false);
    expect(paymentSubmissionBodySchema.safeParse({ txHash: '0xabcd' }).success).toBe(false);
    expect(paymentSubmissionBodySchema.safeParse({}).success).toBe(false);
    expect(paymentSubmissionBodySchema.safeParse({ txHash: 'ab'.repeat(200) }).success).toBe(false);
    expect(paymentSubmissionBodySchema.safeParse({ txHash: HASH_64, extra: 1 }).success).toBe(false);
  });
});
