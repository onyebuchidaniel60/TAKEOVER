// 1 Unit tests — no DB, no chain. Covers the fee predicate matrix,
// hash normalization, the Luna-exact amount conversion round-trip, the
// tolerant fee-state branches (unset / set / misconfigured), and the
// [listing-fee-error] diagnostic line shape.
// Fee fix: the sender is intentionally NOT compared (any wallet may pay;
// the data binding ties the payment to the slot).
import { describe, expect, it } from 'vitest';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { getListingFeeState } from '../src/env';
import {
  assessListingFee,
  expectedFeeDataForSlot,
  listingFeeErrorLine,
  normalizeFeeHash,
  type ExpectedListingFee,
} from '../src/listing-fee/verify';
import { nimFromBaseUnits, nimToBaseUnits } from '../src/payments/amounts';
import type { TxRecord } from '../src/payments/rpc';

const SLOT_ID = '123e4567-e89b-12d3-a456-426614174000';
const FEE_NIM = '15';
const FEE_LUNA = '1500000';

function randomWallet(): string {
  return deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
}

const OWNER = randomWallet();
const FEE_WALLET = randomWallet();
const HASH = 'ac2f80450d454af19efec4e5d405d964d0d0690fded17e588f033d74998317d0';

const EXPECTED: ExpectedListingFee = {
  recipient: FEE_WALLET,
  amountLuna: FEE_LUNA,
  data: expectedFeeDataForSlot(SLOT_ID),
};

function txRecord(overrides: Partial<TxRecord> = {}): TxRecord {
  return {
    hash: HASH,
    sender: OWNER,
    recipient: FEE_WALLET,
    value: FEE_LUNA,
    data: expectedFeeDataForSlot(SLOT_ID),
    confirmations: 5,
    blockNumber: 100,
    ...overrides,
  };
}

describe('assessListingFee', () => {
  it('verifies a well-formed fee transfer', () => {
    const result = assessListingFee(txRecord(), EXPECTED);
    expect(result.status).toBe('verified');
    expect(result.confirmations).toBe(5);
    expect(result.reason).toBeUndefined();
  });

  it('accepts a fee paid from ANY wallet (sender is not compared)', () => {
    // The data binding ties the payment to the slot; who sent it is
    // irrelevant. A different sender must never mismatch.
    const result = assessListingFee(txRecord({ sender: randomWallet() }), EXPECTED);
    expect(result.status).toBe('verified');
    expect(result.reason).toBeUndefined();
  });

  it('rejects each checked field mismatch with its reason', () => {
    expect(assessListingFee(txRecord({ recipient: randomWallet() }), EXPECTED)).toMatchObject({
      status: 'review',
      reason: 'recipient_mismatch',
    });
    expect(assessListingFee(txRecord({ value: '1499999' }), EXPECTED)).toMatchObject({
      status: 'review',
      reason: 'amount_mismatch',
    });
    expect(assessListingFee(txRecord({ value: '1500001' }), EXPECTED)).toMatchObject({
      status: 'review',
      reason: 'amount_mismatch',
    });
    expect(
      assessListingFee(txRecord({ data: 'TAKEOVER:v1:some-claim' }), EXPECTED),
    ).toMatchObject({ status: 'review', reason: 'data_mismatch' });
    expect(
      assessListingFee(txRecord({ data: expectedFeeDataForSlot('other-slot-id') }), EXPECTED),
    ).toMatchObject({ status: 'review', reason: 'data_mismatch' });
  });

  it('reports pending for an unknown hash (not-found)', () => {
    const result = assessListingFee(null, EXPECTED);
    expect(result).toMatchObject({ status: 'pending', reason: 'not-found', confirmations: null });
  });

  it('reports pending for under-confirmed transfers', () => {
    for (const confirmations of [0, 1, 2, null]) {
      const result = assessListingFee(txRecord({ confirmations }), EXPECTED);
      expect(result).toMatchObject({ status: 'pending', reason: 'under-confirmed', confirmations });
    }
  });

  it('verifies at and above the confirmation policy', () => {
    for (const confirmations of [3, 4, 99]) {
      expect(assessListingFee(txRecord({ confirmations }), EXPECTED).status).toBe('verified');
    }
  });

  it('binds the data string to the exact slot', () => {
    expect(expectedFeeDataForSlot(SLOT_ID)).toBe(`TAKEOVER:fee:v1:${SLOT_ID}`);
  });
});

describe('listingFeeErrorLine (diagnostic shape)', () => {
  it('emits the marker plus every field verbatim, nulls preserved', () => {
    const line = listingFeeErrorLine({
      slotId: SLOT_ID,
      txHash: HASH,
      reason: 'amount_mismatch',
      confirmations: 5,
      expectedRecipient: FEE_WALLET,
      actualRecipient: FEE_WALLET,
      expectedAmount: FEE_LUNA,
      actualAmount: '39999999',
      expectedData: expectedFeeDataForSlot(SLOT_ID),
      actualData: null,
    });
    expect(line.startsWith('[listing-fee-error] ')).toBe(true);
    const parsed = JSON.parse(line.replace('[listing-fee-error] ', '')) as Record<string, unknown>;
    expect(parsed).toEqual({
      slotId: SLOT_ID,
      txHash: HASH,
      reason: 'amount_mismatch',
      confirmations: 5,
      expectedRecipient: FEE_WALLET,
      actualRecipient: FEE_WALLET,
      expectedAmount: FEE_LUNA,
      actualAmount: '39999999',
      expectedData: expectedFeeDataForSlot(SLOT_ID),
      actualData: null,
    });
  });

  it('carries no senders, secrets, or session material', () => {
    const line = listingFeeErrorLine({
      slotId: SLOT_ID,
      txHash: HASH,
      reason: 'not-found',
      confirmations: null,
      expectedRecipient: FEE_WALLET,
      actualRecipient: null,
      expectedAmount: FEE_LUNA,
      actualAmount: null,
      expectedData: expectedFeeDataForSlot(SLOT_ID),
      actualData: null,
    });
    const lower = line.toLowerCase();
    for (const banned of ['sender', 'private', 'secret', 'session', 'bearer', 'cookie', 'password']) {
      expect(lower.includes(banned)).toBe(false);
    }
  });
});

describe('normalizeFeeHash', () => {
  it('accepts 64-hex hashes, lowercases, strips 0x', () => {
    expect(normalizeFeeHash(HASH)).toBe(HASH);
    expect(normalizeFeeHash(HASH.toUpperCase())).toBe(HASH);
    expect(normalizeFeeHash(`0x${HASH}`)).toBe(HASH);
  });

  it('rejects malformed hashes', () => {
    expect(normalizeFeeHash('')).toBeNull();
    expect(normalizeFeeHash('abc')).toBeNull();
    expect(normalizeFeeHash('zz'.padEnd(64, '0'))).toBeNull();
    expect(normalizeFeeHash(HASH.slice(0, 63))).toBeNull();
    expect(normalizeFeeHash(`${HASH}00`)).toBeNull();
    expect(normalizeFeeHash(undefined)).toBeNull();
    expect(normalizeFeeHash(null)).toBeNull();
    expect(normalizeFeeHash(123)).toBeNull();
  });
});

describe('listing-fee amount conversion', () => {
  it('converts 15 NIM to exactly 1500000 Luna and back', () => {
    expect(nimToBaseUnits(FEE_NIM)).toBe(FEE_LUNA);
    expect(nimFromBaseUnits(FEE_LUNA)).toBe(FEE_NIM);
  });

  it('round-trips decimal amounts without floats', () => {
    expect(nimFromBaseUnits('150000')).toBe('1.5');
    expect(nimFromBaseUnits('1')).toBe('0.00001');
    expect(nimFromBaseUnits(nimToBaseUnits('123.45678'))).toBe('123.45678');
  });

  it('rejects garbage on both directions', () => {
    expect(() => nimFromBaseUnits('')).toThrow();
    expect(() => nimFromBaseUnits('1.5')).toThrow();
    expect(() => nimFromBaseUnits('-5')).toThrow();
    expect(() => nimFromBaseUnits('0')).toThrow();
    expect(() => nimToBaseUnits('15.000001')).toThrow();
  });
});

describe('getListingFeeState', () => {
  it('reports no fee when unset or blank', () => {
    expect(getListingFeeState({})).toEqual({
      required: false,
      amountNim: null,
      walletAddress: null,
      misconfigured: false,
    });
    expect(getListingFeeState({ LISTING_FEE_NIM: '', TAKEOVER_FEE_WALLET_ADDRESS: '' })).toEqual({
      required: false,
      amountNim: null,
      walletAddress: null,
      misconfigured: false,
    });
  });

  it('reports no fee for an invalid amount', () => {
    expect(getListingFeeState({ LISTING_FEE_NIM: 'free', TAKEOVER_FEE_WALLET_ADDRESS: FEE_WALLET })).toEqual({
      required: false,
      amountNim: null,
      walletAddress: null,
      misconfigured: false,
    });
    expect(getListingFeeState({ LISTING_FEE_NIM: '0', TAKEOVER_FEE_WALLET_ADDRESS: FEE_WALLET })).toEqual({
      required: false,
      amountNim: null,
      walletAddress: null,
      misconfigured: false,
    });
  });

  it('reports required with canonical terms when fully configured', () => {
    expect(
      getListingFeeState({ LISTING_FEE_NIM: '15', TAKEOVER_FEE_WALLET_ADDRESS: FEE_WALLET }),
    ).toEqual({ required: true, amountNim: '15', walletAddress: FEE_WALLET, misconfigured: false });
  });

  it('reports misconfigured when the wallet is missing or malformed (F4)', () => {
    expect(getListingFeeState({ LISTING_FEE_NIM: '15' })).toMatchObject({
      required: true,
      amountNim: '15',
      walletAddress: null,
      misconfigured: true,
    });
    expect(
      getListingFeeState({ LISTING_FEE_NIM: '15', TAKEOVER_FEE_WALLET_ADDRESS: 'NQ00BOGUS' }),
    ).toMatchObject({ required: true, misconfigured: true, walletAddress: null });
  });
});
