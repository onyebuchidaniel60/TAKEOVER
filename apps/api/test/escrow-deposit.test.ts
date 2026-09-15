// Phase 14d-2: USDT deposit ABI decoding (no network) + verification predicate.
// Pure tests: hardcoded log vectors decoded via the viem-backed pure decoder,
// and every assessDeposit branch including canonicalization.
import { describe, expect, it } from 'vitest';
import { decodeDepositedLog } from '../src/escrow/polygon/client';
import { assessDeposit } from '../src/escrow/polygon/verify-deposit';
import type { DepositedEvent } from '../../../packages/shared/src/escrow/contract';

const CONTRACT = '0x3333333333333333333333333333333333333333';
const ESCROW_ID = '0x1111111111111111111111111111111111111111111111111111111111111111';
const BUYER = '0x2222222222222222222222222222222222222222';
const AMOUNT = 1500000n;
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// keccak256("Deposited(bytes32,address,uint256)") — topic0 for the hardcoded log.
const DEPOSITED_TOPIC0 = '0x87d4c0b5e30d6808bc8a94ba1c4d839b29d664151551a31753387ee9ef48429b';
// bytes32 escrowId as topic1 (value itself).
const TOPIC_ESCROW = ESCROW_ID;
// address buyer left-padded to 32 bytes as topic2.
const TOPIC_BUYER = '0x0000000000000000000000002222222222222222222222222222222222222222';
// uint256 amount (1500000 = 0x16e360) as 32-byte data.
const DATA_AMOUNT = '0x000000000000000000000000000000000000000000000000000000000016e360';

function baseEvent(overrides: Partial<DepositedEvent> = {}): DepositedEvent {
  return {
    escrowId: ESCROW_ID,
    participant: BUYER,
    amountBaseUnits: AMOUNT,
    txHash: TX_HASH,
    blockNumber: 12345,
    ...overrides,
  };
}

describe('USDT Deposited log decoding (no network)', () => {
  it('decodes a hardcoded Deposited log to the exact DepositedEvent shape', () => {
    const decoded = decodeDepositedLog(
      {
        address: CONTRACT,
        topics: [DEPOSITED_TOPIC0, TOPIC_ESCROW, TOPIC_BUYER],
        data: DATA_AMOUNT,
        transactionHash: TX_HASH,
        blockNumber: 12345n,
      },
      CONTRACT,
    );
    expect(decoded).toEqual({
      escrowId: ESCROW_ID,
      participant: BUYER,
      amountBaseUnits: AMOUNT,
      txHash: TX_HASH,
      blockNumber: 12345,
    });
  });

  it('filters out a wrong-contract-address log (returns null)', () => {
    const decoded = decodeDepositedLog(
      {
        address: '0x4444444444444444444444444444444444444444',
        topics: [DEPOSITED_TOPIC0, TOPIC_ESCROW, TOPIC_BUYER],
        data: DATA_AMOUNT,
        transactionHash: TX_HASH,
        blockNumber: 12345n,
      },
      CONTRACT,
    );
    expect(decoded).toBeNull();
  });

  it('throws on a malformed log instead of silently ignoring it', () => {
    expect(() =>
      decodeDepositedLog(
        {
          address: CONTRACT,
          topics: [DEPOSITED_TOPIC0, TOPIC_ESCROW, TOPIC_BUYER],
          data: '0x1234',
          transactionHash: TX_HASH,
          blockNumber: 12345n,
        },
        CONTRACT,
      ),
    ).toThrow();
  });
});

describe('assessDeposit predicate', () => {
  const expected = { onChainEscrowId: ESCROW_ID, buyerWallet: BUYER, amountBaseUnits: AMOUNT };

  it('null event → pending', () => {
    expect(assessDeposit(null, expected)).toEqual({ status: 'pending' });
  });

  it('wrong escrowId → mismatch(escrow_id)', () => {
    const event = baseEvent({
      escrowId: '0x9999999999999999999999999999999999999999999999999999999999999999',
    });
    expect(assessDeposit(event, expected)).toEqual({ status: 'mismatch', reason: 'escrow_id' });
  });

  it('wrong buyer → mismatch(buyer)', () => {
    const event = baseEvent({ participant: '0x5555555555555555555555555555555555555555' });
    expect(assessDeposit(event, expected)).toEqual({ status: 'mismatch', reason: 'buyer' });
  });

  it('wrong amount → mismatch(amount)', () => {
    const event = baseEvent({ amountBaseUnits: AMOUNT - 1n });
    expect(assessDeposit(event, expected)).toEqual({ status: 'mismatch', reason: 'amount' });
  });

  it('matched event → matched', () => {
    expect(assessDeposit(baseEvent(), expected)).toEqual({ status: 'matched' });
  });

  it('canonicalizes the buyer wallet (spaced vs canonical)', () => {
    const spaced = '0x2222 22222222 22222222 22222222 22222222 2222';
    expect(assessDeposit(baseEvent(), { ...expected, buyerWallet: spaced })).toEqual({
      status: 'matched',
    });
    const upper = BUYER.toUpperCase();
    expect(assessDeposit(baseEvent({ participant: upper }), expected)).toEqual({
      status: 'matched',
    });
  });

  it('accepts the brief-named buyer field as an alias for participant', () => {
    const aliased = { ...baseEvent(), buyer: BUYER } as unknown as DepositedEvent;
    expect(assessDeposit(aliased, expected)).toEqual({ status: 'matched' });
  });

  it('checks fields in locked order (escrow_id beats buyer beats amount)', () => {
    const allWrong = baseEvent({
      escrowId: '0x9999999999999999999999999999999999999999999999999999999999999999',
      participant: '0x5555555555555555555555555555555555555555',
      amountBaseUnits: 1n,
    });
    expect(assessDeposit(allWrong, expected)).toEqual({ status: 'mismatch', reason: 'escrow_id' });
    const buyerAndAmount = baseEvent({
      participant: '0x5555555555555555555555555555555555555555',
      amountBaseUnits: 1n,
    });
    expect(assessDeposit(buyerAndAmount, expected)).toEqual({ status: 'mismatch', reason: 'buyer' });
  });
});
