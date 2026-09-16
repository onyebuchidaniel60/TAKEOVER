// Phase 14d-3b: refund() + disputeCallData() client tests (no network, no DB).
// viem's network edge is mocked at the module boundary (this file only —
// every test file runs in its own worker); signing uses the real
// throwaway test vector from escrow-signer.test.ts via loadEscrowSigner.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { REFUND_TX } = vi.hoisted(() => ({
  REFUND_TX: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      getChainId: async () => 137,
    }),
    createWalletClient: () => ({
      writeContract: async () => REFUND_TX,
    }),
  };
});

import {
  createPolygonEscrowClient,
  disputeCallData,
  EscrowContractUnavailableError,
  EscrowSignerUnavailableError,
} from '../src/escrow/polygon/client';
import { resetEscrowSignerCache } from '../src/escrow/polygon/signer';

// Throwaway test vector (same provenance as escrow-signer.test.ts: locally
// generated random key; not a secret, never deployed, never funded).
const DEV_KEY = '0x7d55f2055b8df473b591f640d1d6adfabeab1960ff7eb6dca603eb3fdae531c5';
const TEST_CONTRACT = '0x3333333333333333333333333333333333333333';
const ONCHAIN_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('escrow refund client', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.ESCROW_SIGNER_PRIVATE_KEY = process.env.ESCROW_SIGNER_PRIVATE_KEY;
    saved.ESCROW_SIGNER_ADDRESS = process.env.ESCROW_SIGNER_ADDRESS;
    saved.USDT_ESCROW_CONTRACT_ADDRESS = process.env.USDT_ESCROW_CONTRACT_ADDRESS;
    resetEscrowSignerCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetEscrowSignerCache();
  });

  it('refund success returns the broadcast tx hash (mocked signer + contract call)', async () => {
    process.env.ESCROW_SIGNER_PRIVATE_KEY = DEV_KEY;
    delete process.env.ESCROW_SIGNER_ADDRESS;
    const client = createPolygonEscrowClient({
      rpcUrl: 'http://127.0.0.1:9',
      contractAddress: TEST_CONTRACT,
    });
    await expect(client.refund(ONCHAIN_ID)).resolves.toEqual({ txHash: REFUND_TX });
  });

  it('refund with missing signer → EscrowSignerUnavailableError (no network touched)', async () => {
    delete process.env.ESCROW_SIGNER_PRIVATE_KEY;
    delete process.env.ESCROW_SIGNER_ADDRESS;
    const client = createPolygonEscrowClient({
      rpcUrl: 'http://127.0.0.1:9',
      contractAddress: TEST_CONTRACT,
    });
    await expect(client.refund(ONCHAIN_ID)).rejects.toBeInstanceOf(EscrowSignerUnavailableError);
  });

  it('refund with malformed escrow id → EscrowContractUnavailableError', async () => {
    process.env.ESCROW_SIGNER_PRIVATE_KEY = DEV_KEY;
    delete process.env.ESCROW_SIGNER_ADDRESS;
    const client = createPolygonEscrowClient({
      rpcUrl: 'http://127.0.0.1:9',
      contractAddress: TEST_CONTRACT,
    });
    await expect(client.refund('not-an-id')).rejects.toBeInstanceOf(EscrowContractUnavailableError);
  });

  it('disputeCallData returns contract, escrow id, and non-empty calldata', () => {
    const instruction = disputeCallData(ONCHAIN_ID, TEST_CONTRACT);
    expect(instruction.contractAddress).toBe(TEST_CONTRACT);
    expect(instruction.onChainEscrowId).toBe(ONCHAIN_ID);
    expect(instruction.callData.startsWith('0x')).toBe(true);
    // dispute(bytes32): 4-byte selector + one 32-byte arg.
    expect(instruction.callData).toHaveLength(2 + 8 + 64);
    expect(instruction.callData.endsWith(ONCHAIN_ID.slice(2))).toBe(true);
  });

  it('disputeCallData without a configured contract → EscrowContractUnavailableError', () => {
    delete process.env.USDT_ESCROW_CONTRACT_ADDRESS;
    expect(() => disputeCallData(ONCHAIN_ID)).toThrow(EscrowContractUnavailableError);
  });

  it('the refund path never touches key material (source scan)', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'escrow', 'polygon', 'client.ts'), 'utf8');
    // The client loads the signer only through loadEscrowSigner — it must
    // never read the private key env var directly, log, or return it.
    expect(source).not.toContain('ESCROW_SIGNER_PRIVATE_KEY');
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/JSON\.stringify\(account/);
    expect(source).not.toContain('privateKey');
  });
});
