// USDT deposit ABI decoding (no network) + verification predicate.
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

describe('assessDeposit predicate (model B: escrowId + amount only)', () => {
  const expected = { onChainEscrowId: ESCROW_ID, amountBaseUnits: AMOUNT };

  it('null event → pending', () => {
    expect(assessDeposit(null, expected)).toEqual({ status: 'pending' });
  });

  it('wrong escrowId → mismatch(escrow_id)', () => {
    const event = baseEvent({
      escrowId: '0x9999999999999999999999999999999999999999999999999999999999999999',
    });
    expect(assessDeposit(event, expected)).toEqual({ status: 'mismatch', reason: 'escrow_id' });
  });

  it('wrong amount → mismatch(amount)', () => {
    const event = baseEvent({ amountBaseUnits: AMOUNT - 1n });
    expect(assessDeposit(event, expected)).toEqual({ status: 'mismatch', reason: 'amount' });
  });

  it('matched event → matched', () => {
    expect(assessDeposit(baseEvent(), expected)).toEqual({ status: 'matched' });
  });

  it('on-chain buyer differing from the Nimiq wallet does NOT cause a mismatch', () => {
    // Model B: the EVM buyer is recorded for refund routing, never compared
    // against users.wallet_address. A Nimiq identity next to an EVM depositor
    // still verifies on escrowId + amount.
    const nimiqWallet = 'NQ32 1234 5678 90AB CDEF GHIJ KLMN OPQR STUV';
    void nimiqWallet;
    const event = baseEvent({ participant: '0x9999999999999999999999999999999999999999' });
    expect(assessDeposit(event, expected)).toEqual({ status: 'matched' });
  });

  it('arbitrary EVM depositor with correct escrowId and amount → matched', () => {
    const event = baseEvent({ participant: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(assessDeposit(event, expected)).toEqual({ status: 'matched' });
  });

  it('matches escrowId case-insensitively', () => {
    const event = baseEvent({ escrowId: ESCROW_ID.toUpperCase() });
    expect(assessDeposit(event, expected)).toEqual({ status: 'matched' });
  });

  it('checks fields in locked order (escrow_id beats amount)', () => {
    const bothWrong = baseEvent({
      escrowId: '0x9999999999999999999999999999999999999999999999999999999999999999',
      amountBaseUnits: 1n,
    });
    expect(assessDeposit(bothWrong, expected)).toEqual({ status: 'mismatch', reason: 'escrow_id' });
  });
});
