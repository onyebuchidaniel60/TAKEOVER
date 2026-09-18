// Phase 5 unit tests — no database. Covers publish validation (each field
// failing on its own), payout-wallet checksums, and the lifecycle state guards.
import { describe, expect, it } from 'vitest';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { AppError } from '../src/http/errors';
import {
  canonicalizePayoutWallet,
  requireCancellableStatus,
  requireDraftForEdit,
  requireDraftForPublish,
  validatePublishable,
  type PublishableInput,
} from '../src/slots/validation';

const VALID_PAYOUT = deriveNimiqAddress(new Uint8Array(32).fill(7));
const NOW = new Date('2026-09-11T12:00:00.000Z');

function validDraft(): PublishableInput {
  return {
    title: 'Table for two',
    startsAt: new Date(NOW.getTime() + 3_600_000),
    endsAt: new Date(NOW.getTime() + 2 * 3_600_000),
    priceUsdt: 150000n,
    totalQuantity: 2,
    payoutWallet: VALID_PAYOUT,
  };
}

describe('validatePublishable', () => {
  it('passes a fully valid draft', () => {
    expect(validatePublishable(validDraft(), NOW)).toEqual([]);
  });

  it('fails each required field individually', () => {
    expect(validatePublishable({ ...validDraft(), title: '' }, NOW)).toEqual(['title']);
    expect(validatePublishable({ ...validDraft(), title: '   ' }, NOW)).toEqual(['title']);
    expect(validatePublishable({ ...validDraft(), startsAt: new Date(NOW) }, NOW)).toEqual([
      'starts_at',
    ]);
    expect(
      validatePublishable({ ...validDraft(), startsAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toEqual(['starts_at']);
    expect(
      validatePublishable(
        { ...validDraft(), endsAt: new Date(NOW.getTime() + 3_600_000) },
        NOW,
      ),
    ).toEqual(['ends_at']);
    expect(validatePublishable({ ...validDraft(), priceUsdt: 0n }, NOW)).toEqual(['price_usdt']);
    expect(validatePublishable({ ...validDraft(), totalQuantity: 0 }, NOW)).toEqual([
      'total_quantity',
    ]);
    expect(validatePublishable({ ...validDraft(), payoutWallet: 'NQ00 SEEDPAYOUT00000001' }, NOW)).toEqual([
      'payout_wallet',
    ]);
  });

  it('accepts a missing ends_at', () => {
    expect(validatePublishable({ ...validDraft(), endsAt: null }, NOW)).toEqual([]);
  });
});

describe('payout_wallet validation', () => {
  it("rejects the Phase 4 seed fixture pattern (bad checksum)", () => {
    expect(() => canonicalizePayoutWallet('NQ00 SEEDPAYOUT000000000001')).toThrowError(AppError);
    try {
      canonicalizePayoutWallet('NQ00 SEEDPAYOUT000000000001');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('INVALID_INPUT');
    }
  });

  it('accepts a valid Nimiq address and canonicalizes it', () => {
    expect(canonicalizePayoutWallet(VALID_PAYOUT.toLowerCase())).toBe(VALID_PAYOUT);
  });
});

describe('lifecycle state guards', () => {
  it('edit: draft passes, everything else is SLOT_NOT_EDITABLE', () => {
    expect(() => requireDraftForEdit('draft')).not.toThrow();
    for (const status of ['published', 'cancelled', 'sold_out', 'expired'] as const) {
      try {
        requireDraftForEdit(status);
        expect.unreachable(`expected throw for ${status}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('SLOT_NOT_EDITABLE');
      }
    }
  });

  it('publish: draft passes, everything else is SLOT_NOT_PUBLISHABLE', () => {
    expect(() => requireDraftForPublish('draft')).not.toThrow();
    for (const status of ['published', 'cancelled', 'sold_out', 'expired'] as const) {
      try {
        requireDraftForPublish(status);
        expect.unreachable(`expected throw for ${status}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('SLOT_NOT_PUBLISHABLE');
      }
    }
  });

  it('cancel: draft and published pass, the rest is SLOT_NOT_CANCELLABLE', () => {
    expect(() => requireCancellableStatus('draft')).not.toThrow();
    expect(() => requireCancellableStatus('published')).not.toThrow();
    for (const status of ['sold_out', 'cancelled', 'expired'] as const) {
      try {
        requireCancellableStatus(status);
        expect.unreachable(`expected throw for ${status}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('SLOT_NOT_CANCELLABLE');
      }
    }
  });
});
