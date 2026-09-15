// Phase 14d-1 escrow contract interface tests (no network, no chain).
// Proves the shared ABI const parses as JSON and its function/event
// signatures match docs/escrow-contract-interface.md exactly, so the
// separate Solidity repo and this repo's future backend client agree.
import { describe, expect, it } from 'vitest';
import {
  ESCROW_CONTRACT_ABI,
  type DisputedEvent,
  type DepositedEvent,
  type ReleasedEvent,
  type RefundedEvent,
} from '../../../packages/shared/src/escrow/contract';

interface AbiInput {
  name?: string;
  type: string;
  indexed?: boolean;
}

interface AbiEntry {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: AbiInput[];
}

function canonicalSignature(entry: AbiEntry): string {
  const params = (entry.inputs ?? []).map((input) => input.type).join(',');
  return `${entry.name ?? ''}(${params})`;
}

describe('escrow contract ABI', () => {
  it('parses as JSON with 4 functions and 4 events', () => {
    const parsed = JSON.parse(JSON.stringify(ESCROW_CONTRACT_ABI)) as AbiEntry[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.filter((entry) => entry.type === 'function')).toHaveLength(4);
    expect(parsed.filter((entry) => entry.type === 'event')).toHaveLength(4);
  });

  it('matches the written function and event signatures exactly', () => {
    const entries = ESCROW_CONTRACT_ABI as unknown as AbiEntry[];
    const functions = entries.filter((entry) => entry.type === 'function');
    expect(functions.map(canonicalSignature).sort()).toEqual(
      ['deposit(bytes32,uint256)', 'dispute(bytes32)', 'refund(bytes32)', 'release(bytes32)'].sort(),
    );
    for (const fn of functions) {
      expect(fn.stateMutability).toBe('nonpayable');
    }
    const events = entries.filter((entry) => entry.type === 'event');
    expect(events.map(canonicalSignature).sort()).toEqual(
      [
        'Deposited(bytes32,address,uint256)',
        'Disputed(bytes32,address)',
        'Released(bytes32,address,uint256)',
        'Refunded(bytes32,address,uint256)',
      ].sort(),
    );
    const byName = new Map(events.map((entry) => [entry.name, entry]));
    for (const name of ['Deposited', 'Released', 'Refunded']) {
      const inputs = byName.get(name)?.inputs ?? [];
      expect(inputs.map((input) => input.indexed)).toEqual([true, true, false]);
    }
    expect((byName.get('Disputed')?.inputs ?? []).map((input) => input.indexed)).toEqual([true, true]);
  });

  it('event types carry the specified fields (typechecked)', () => {
    const deposited: DepositedEvent = {
      escrowId: '0x00',
      participant: '0x01',
      amountBaseUnits: 1000000n,
      txHash: '0x02',
      blockNumber: 1,
    };
    const released: ReleasedEvent = { ...deposited };
    const refunded: RefundedEvent = { ...deposited };
    const disputed: DisputedEvent = { ...deposited, amountBaseUnits: null };
    expect([deposited, released, refunded].map((event) => event.amountBaseUnits)).toEqual([1000000n, 1000000n, 1000000n]);
    expect(disputed.amountBaseUnits).toBeNull();
  });
});
