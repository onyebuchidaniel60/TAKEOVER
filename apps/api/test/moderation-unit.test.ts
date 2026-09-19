// unit tests — no DB. Reason enum, notes bounds, report-target
// guard, and the admin allowlist parser.
import { describe, expect, it } from 'vitest';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { isAdminWallet, parseAdminWallets } from '../src/auth/admin';
import {
  hasReportTarget,
  notesField,
  reportCreateBodySchema,
  reportReasonValues,
} from '../src/reports/validation';

describe('report reason enum', () => {
  it('accepts exactly the five spec (FR-10) reasons', () => {
    expect([...reportReasonValues].sort()).toEqual(
      [
        'misleading_listing',
        'unauthorized_listing',
        'prohibited_content',
        'payment_issue',
        'other',
      ].sort(),
    );
    for (const reason of reportReasonValues) {
      const parsed = reportCreateBodySchema.safeParse({ reason });
      // Missing target is a service-level 400, not a shape error — but the
      // reason itself must parse. Supply a dummy uuid to isolate the reason.
      const withTarget = reportCreateBodySchema.safeParse({
        reason,
        slotId: '11111111-1111-4111-8111-111111111111',
      });
      expect(withTarget.success).toBe(true);
      void parsed;
    }
  });

  it('rejects unknown reasons and unknown fields', () => {
    // Pre-reconciliation values are no longer valid reasons.
    for (const reason of ['spam', 'fraud', 'misleading', 'inappropriate']) {
      const bad = reportCreateBodySchema.safeParse({
        reason,
        slotId: '11111111-1111-4111-8111-111111111111',
      });
      expect(bad.success).toBe(false);
    }
    const extra = reportCreateBodySchema.safeParse({
      reason: 'other',
      slotId: '11111111-1111-4111-8111-111111111111',
      role: 'admin',
    });
    expect(extra.success).toBe(false);
  });
});

describe('resolutionNotes / disable reason bounds', () => {
  it('rejects under 5 chars, accepts 5, accepts 1000, rejects 1001', () => {
    expect(notesField.safeParse('abcd').success).toBe(false);
    expect(notesField.safeParse('abcde').success).toBe(true);
    expect(notesField.safeParse('x'.repeat(1000)).success).toBe(true);
    expect(notesField.safeParse('x'.repeat(1001)).success).toBe(false);
  });

  it('trims before measuring', () => {
    expect(notesField.safeParse('   abcde   ').success).toBe(true);
    expect(notesField.safeParse('   ab   ').success).toBe(false);
  });
});

describe('report target guard', () => {
  it('rejects a body with neither slotId nor targetUserId', () => {
    expect(hasReportTarget({})).toBe(false);
  });

  it('accepts slot-only, user-only, and both', () => {
    expect(hasReportTarget({ slotId: 'x' })).toBe(true);
    expect(hasReportTarget({ targetUserId: 'y' })).toBe(true);
    expect(hasReportTarget({ slotId: 'x', targetUserId: 'y' })).toBe(true);
  });
});

describe('admin allowlist parsing', () => {
  function randomWallet(): string {
    return deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
  }

  it('is empty when unset or blank', () => {
    expect(parseAdminWallets({})).toEqual([]);
    expect(parseAdminWallets({ ADMIN_WALLET_ADDRESSES: '' })).toEqual([]);
    expect(parseAdminWallets({ ADMIN_WALLET_ADDRESSES: '   ' })).toEqual([]);
  });

  it('parses comma-separated canonical wallets, tolerating case/spaces', () => {
    const a = randomWallet();
    const b = randomWallet();
    const parsed = parseAdminWallets({
      ADMIN_WALLET_ADDRESSES: ` ${a.toLowerCase()} , ${b} `,
    });
    expect(parsed).toEqual([a, b]);
  });

  it('ignores invalid entries instead of failing boot', () => {
    const a = randomWallet();
    expect(parseAdminWallets({ ADMIN_WALLET_ADDRESSES: `nope, ${a}` })).toEqual([a]);
  });

  it('matches allowlisted wallets only', () => {
    const a = randomWallet();
    const b = randomWallet();
    const env = { ADMIN_WALLET_ADDRESSES: a };
    expect(isAdminWallet(a, env)).toBe(true);
    expect(isAdminWallet(b, env)).toBe(false);
    expect(isAdminWallet(a, {})).toBe(false);
  });
});
