// Phase 8 unit tests — no database. Covers the pure verification predicate
// (one failing check at a time), BigInt amount boundaries, the confirmation
// threshold, the pending-timeout predicate, the per-claim limiter, and RPC
// normalization. Chain reads are injected fakes elsewhere, never here.
import { describe, expect, it } from 'vitest';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import {
  DEFAULT_NIMIQ_RPC_URL,
  getNimiqRpcUrl,
  RpcUnavailableError,
  toTxRecord,
} from '../src/payments/rpc';
import { assessTransaction, isPaymentPendingTimedOut } from '../src/payments/verify';
import { createVerifyRateLimiter } from '../src/payments/verify-rate-limit';
import type { TxRecord } from '../src/payments/rpc';

const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';
const HASH = 'ab'.repeat(32);
const BUYER = deriveNimiqAddress(new Uint8Array(32).fill(11));
const PAYOUT = deriveNimiqAddress(new Uint8Array(32).fill(22));
const ATTACKER = deriveNimiqAddress(new Uint8Array(32).fill(33));
const DATA = `TAKEOVER:v1:${CLAIM_ID}`;

function txRecord(overrides: Partial<TxRecord> = {}): TxRecord {
  return {
    hash: HASH,
    sender: BUYER,
    recipient: PAYOUT,
    value: '150000',
    data: DATA,
    confirmations: 5,
    blockNumber: 100,
    ...overrides,
  };
}

function expected() {
  return { hash: HASH, sender: BUYER, recipient: PAYOUT, amount: '150000', data: DATA };
}

describe('assessTransaction', () => {
  it('verifies a fully matching, confirmed transaction', () => {
    expect(assessTransaction(txRecord(), expected())).toEqual({
      outcome: 'verified',
      confirmations: 5,
    });
  });

  it('reports pending when the transaction is not on chain', () => {
    expect(assessTransaction(null, expected())).toEqual({ outcome: 'pending', confirmations: null });
  });

  it('reviews a sender mismatch with all other checks passing', () => {
    expect(assessTransaction(txRecord({ sender: ATTACKER }), expected())).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'sender_mismatch',
    });
  });

  it('reviews a recipient mismatch with all other checks passing', () => {
    expect(assessTransaction(txRecord({ recipient: ATTACKER }), expected())).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'recipient_mismatch',
    });
  });

  it('reviews an amount mismatch with all other checks passing', () => {
    expect(assessTransaction(txRecord({ value: '149999' }), expected())).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'amount_mismatch',
    });
  });

  it('reviews a data mismatch (trailing space) with all other checks passing', () => {
    expect(assessTransaction(txRecord({ data: `${DATA} ` }), expected())).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'data_mismatch',
    });
  });

  it('reviews a data case change byte-for-byte', () => {
    expect(assessTransaction(txRecord({ data: DATA.toLowerCase() }), expected()).outcome).toBe(
      'review',
    );
  });

  it('compares amounts via BigInt past 2^53 without float loss', () => {
    const big = '9007199254740993';
    const exp = { ...expected(), amount: big };
    expect(assessTransaction(txRecord({ value: big }), exp).outcome).toBe('verified');
    expect(assessTransaction(txRecord({ value: '9007199254740992' }), exp)).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'amount_mismatch',
    });
  });

  it('holds at 2 confirmations, verifies at 3 and at 100', () => {
    expect(assessTransaction(txRecord({ confirmations: 2 }), expected())).toEqual({
      outcome: 'pending',
      confirmations: 2,
    });
    expect(assessTransaction(txRecord({ confirmations: 3 }), expected()).outcome).toBe('verified');
    expect(assessTransaction(txRecord({ confirmations: 100 }), expected()).outcome).toBe(
      'verified',
    );
  });

  it('stays pending when no confirmation evidence exists', () => {
    expect(
      assessTransaction(txRecord({ confirmations: null, blockNumber: null }), expected()),
    ).toEqual({ outcome: 'pending', confirmations: null });
  });

  it('asserts the hash after every other check passes', () => {
    expect(assessTransaction(txRecord({ hash: 'cd'.repeat(32) }), expected())).toEqual({
      outcome: 'review',
      confirmations: 5,
      mismatch: 'hash_mismatch',
    });
  });

  it('treats hash case as insignificant (hex, not bytes)', () => {
    expect(assessTransaction(txRecord(), { ...expected(), hash: HASH.toUpperCase() }).outcome).toBe(
      'verified',
    );
  });

  it('accepts spaced user-friendly chain addresses against canonical intent values', () => {
    const spaced = (addr: string): string =>
      `${addr.slice(0, 4)} ${addr.slice(4, 8)} ${addr.slice(8, 12)} ${addr.slice(12, 16)} ${addr.slice(16, 20)} ${addr.slice(20, 24)} ${addr.slice(24, 28)} ${addr.slice(28, 32)} ${addr.slice(32)}`;
    const tx = txRecord({ sender: spaced(BUYER), recipient: spaced(PAYOUT) });
    expect(assessTransaction(tx, expected()).outcome).toBe('verified');
  });
});

describe('isPaymentPendingTimedOut', () => {
  it('ages an old pending submission to review', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    const old = new Date(now.getTime() - 1801 * 1000);
    expect(isPaymentPendingTimedOut(old, now, 1800)).toBe(true);
  });

  it('keeps a young pending submission pending', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    const young = new Date(now.getTime() - 1799 * 1000);
    expect(isPaymentPendingTimedOut(young, now, 1800)).toBe(false);
  });

  it('does not time out exactly at the boundary or without a submission time', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    expect(isPaymentPendingTimedOut(new Date(now.getTime() - 1800 * 1000), now, 1800)).toBe(false);
    expect(isPaymentPendingTimedOut(null, now, 1800)).toBe(false);
  });
});

describe('createVerifyRateLimiter', () => {
  it('allows one check per claim per window with a Retry-After on denial', () => {
    const limiter = createVerifyRateLimiter({ windowMs: 5_000 });
    expect(limiter.check('claim-a', 1_000)).toEqual({ allowed: true });
    const denied = limiter.check('claim-a', 1_001);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(5);
    expect(limiter.check('claim-b', 1_001)).toEqual({ allowed: true });
    expect(limiter.check('claim-a', 6_000)).toEqual({ allowed: true });
  });
});

describe('RPC normalization', () => {
  const wire = {
    hash: HASH,
    blockNumber: 61350291,
    timestamp: 1789159198127,
    confirmations: 13,
    size: 195,
    relatedAddresses: [],
    from: 'NQ16 2SSN 82TL SMQS KXT3 Q01V CMAL NU6F 1LJG',
    fromType: 0,
    to: 'NQ87 1T87 4A9R 0TRJ KNPB VKN6 FJXT S92M LD3S',
    toType: 0,
    value: 99847,
    fee: 0,
    senderData: '',
    recipientData: '596f75206d696e6564204e494d206f6e204e696d69712e537061636521',
    flags: 0,
    validityStartHeight: 61350283,
    proof: '00',
    networkId: 24,
    executionResult: true,
  };

  it('normalizes the live wire shape (number value, hex data, spaced addresses)', () => {
    expect(toTxRecord(wire, HASH)).toEqual({
      hash: HASH,
      sender: 'NQ16 2SSN 82TL SMQS KXT3 Q01V CMAL NU6F 1LJG',
      recipient: 'NQ87 1T87 4A9R 0TRJ KNPB VKN6 FJXT S92M LD3S',
      value: '99847',
      data: 'You mined NIM on Nimiq.Space!',
      confirmations: 13,
      blockNumber: 61350291,
    });
  });

  it('nulls missing confirmations and null recipients instead of crashing', () => {
    const record = toTxRecord({ ...wire, confirmations: undefined, to: null }, HASH);
    expect(record.confirmations).toBeNull();
    expect(record.recipient).toBeNull();
  });

  it('rejects garbage values as RPC failures, never as mismatches', () => {
    expect(() => toTxRecord({ ...wire, value: 1.5 }, HASH)).toThrow(RpcUnavailableError);
    expect(() => toTxRecord({ ...wire, from: '' }, HASH)).toThrow(RpcUnavailableError);
    expect(() => toTxRecord(null, HASH)).toThrow(RpcUnavailableError);
  });

  it('defaults to the public endpoint unless NIMIQ_RPC_URL is set', () => {
    expect(getNimiqRpcUrl({})).toBe(DEFAULT_NIMIQ_RPC_URL);
    expect(getNimiqRpcUrl({ NIMIQ_RPC_URL: '' })).toBe(DEFAULT_NIMIQ_RPC_URL);
    expect(getNimiqRpcUrl({ NIMIQ_RPC_URL: 'https://node.example.com ' })).toBe(
      'https://node.example.com',
    );
  });
});
