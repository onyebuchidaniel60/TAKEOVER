// Phase 14e P1: evm.ts unit tests (node env, no DOM, no network).
// Calldata vectors were generated with the backend's viem (2.56.5) at
// authoring time — the web hand-encoder (D1, zero new deps) must match
// viem byte-for-byte.
import { describe, expect, it, vi } from 'vitest';
import {
  AMOY_CHAIN_ID,
  AMOY_CHAIN_ID_HEX,
  APPROVE_GAS_LIMIT,
  DEPOSIT_GAS_LIMIT,
  DISPUTE_GAS_LIMIT,
  EvmRpcError,
  NoEthereumProviderError,
  ReceiptTimeoutError,
  UserRejectedError,
  approve,
  deposit,
  encodeApproveCall,
  encodeDepositCall,
  encodeDisputeCall,
  ensureChain,
  getAccounts,
  getEthereumProvider,
  normalizeAddress,
  normalizeBytes32,
  normalizeGasLimit,
  normalizeUint256,
  sendTransaction,
  waitForReceipt,
  type EthereumProvider,
} from '../src/lib/evm';

const ESCROW = '0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06';
const TOKEN = '0xC885e1eeD2A2f2215b756Fa04B89aAD1A27559dE';
const EID = `0x${'ab'.repeat(32)}`;
const AMOUNT = '1500000';

// viem-generated vectors (encodeFunctionData, same inputs).
const APPROVE_VEC =
  '0x095ea7b3' +
  '0000000000000000000000007f8f66e1e07372dc371edf8f21d2d84208a4fc06' +
  '000000000000000000000000000000000000000000000000000000000016e360';
const DEPOSIT_VEC =
  '0x1de26e16' +
  'ab'.repeat(32) +
  '000000000000000000000000000000000000000000000000000000000016e360';
const DISPUTE_VEC = '0xadd98c70' + 'ab'.repeat(32);

function fakeProvider(handler: (method: string, params?: unknown) => unknown): {
  provider: EthereumProvider;
  calls: Array<{ method: string; params?: unknown }>;
} {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const provider: EthereumProvider = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      return handler(method, params);
    }),
  };
  return { provider, calls };
}

describe('calldata encoding (viem-pinned vectors)', () => {
  it('approve(address,uint256) matches viem byte-for-byte', () => {
    expect(encodeApproveCall(ESCROW, AMOUNT)).toBe(APPROVE_VEC);
  });

  it('deposit(bytes32,uint256) matches viem byte-for-byte', () => {
    expect(encodeDepositCall(EID, AMOUNT)).toBe(DEPOSIT_VEC);
  });

  it('dispute(bytes32) matches viem byte-for-byte', () => {
    expect(encodeDisputeCall(EID)).toBe(DISPUTE_VEC);
  });

  it('address input is case-insensitive but output is lowercase', () => {
    expect(encodeApproveCall(ESCROW.toUpperCase(), AMOUNT)).toBe(APPROVE_VEC);
  });

  it('amount accepts bigint and decimal strings identically', () => {
    expect(encodeDepositCall(EID, 1500000n)).toBe(DEPOSIT_VEC);
  });
});

describe('input validation (fail closed, never a malformed broadcast)', () => {
  it('rejects malformed addresses', () => {
    for (const bad of ['', '0x1234', 'not-an-address', '0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ']) {
      expect(() => normalizeAddress(bad)).toThrow();
      expect(() => encodeApproveCall(bad, AMOUNT)).toThrow();
    }
  });

  it('rejects malformed bytes32 escrow ids', () => {
    for (const bad of ['', '0x1234', EID.slice(2)]) {
      expect(() => normalizeBytes32(bad)).toThrow();
      expect(() => encodeDepositCall(bad, AMOUNT)).toThrow();
      expect(() => encodeDisputeCall(bad)).toThrow();
    }
  });

  it('rejects non-positive, fractional, and overflowing amounts', () => {
    for (const bad of ['0', '-1', '1.5', 'nope', String(1n << 256n)]) {
      expect(() => normalizeUint256(bad)).toThrow();
    }
    expect(normalizeUint256('1500000')).toBe(1500000n);
  });
});

describe('provider + chain handling', () => {
  it('chain constants target Polygon Amoy', () => {
    expect(AMOY_CHAIN_ID).toBe(80002);
    expect(AMOY_CHAIN_ID_HEX).toBe('0x13882');
  });

  it('missing window.ethereum → user-facing NoEthereumProviderError', () => {
    expect(() => getEthereumProvider()).toThrow(NoEthereumProviderError);
  });

  it('matching chain → no switch call', async () => {
    const { provider, calls } = fakeProvider(() => AMOY_CHAIN_ID_HEX);
    await ensureChain(provider);
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId']);
  });

  it('mismatched chain → switch with the Amoy id', async () => {
    const { provider, calls } = fakeProvider((method) => {
      if (method === 'eth_chainId') return '0x1';
      return null;
    });
    await ensureChain(provider);
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    expect(calls[1]?.params).toEqual([{ chainId: AMOY_CHAIN_ID_HEX }]);
  });

  it('4902 → add chain with explicit Amoy params', async () => {
    const { provider, calls } = fakeProvider((method) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') {
        throw Object.assign(new Error('unknown chain'), { code: 4902 });
      }
      return null;
    });
    await ensureChain(provider);
    const add = calls.find((c) => c.method === 'wallet_addEthereumChain');
    expect(add?.params).toEqual([
      {
        chainId: AMOY_CHAIN_ID_HEX,
        chainName: 'Polygon Amoy',
        nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
        rpcUrls: ['https://rpc-amoy.polygon.technology/'],
        blockExplorerUrls: ['https://amoy.polygonscan.com/'],
      },
    ]);
  });

  it('user rejection (4001) propagates distinctly from RPC failure', async () => {
    const { provider } = fakeProvider((method) => {
      if (method === 'eth_chainId') return '0x1';
      throw Object.assign(new Error('rejected'), { code: 4001 });
    });
    await expect(ensureChain(provider)).rejects.toThrow(UserRejectedError);
  });

  it('empty accounts → EvmRpcError', async () => {
    const { provider } = fakeProvider(() => []);
    await expect(getAccounts(provider)).rejects.toThrow(EvmRpcError);
  });
});

describe('send + receipt', () => {
  const TX = `0x${'cd'.repeat(32)}`;

  it('approve sends exact-amount calldata to the token contract', async () => {
    const { provider, calls } = fakeProvider(() => TX);
    const hash = await approve(provider, { token: TOKEN, spender: ESCROW, amount: AMOUNT, from: TOKEN });
    expect(hash).toBe(TX.toLowerCase());
    const sent = calls.find((c) => c.method === 'eth_sendTransaction');
    expect(sent?.params).toEqual([
      { from: TOKEN.toLowerCase(), to: TOKEN.toLowerCase(), data: APPROVE_VEC, gas: APPROVE_GAS_LIMIT },
    ]);
  });

  it('deposit sends escrow calldata to the contract', async () => {
    const { provider, calls } = fakeProvider(() => TX);
    await deposit(provider, { contract: ESCROW, escrowId: EID, amount: AMOUNT, from: TOKEN });
    const sent = calls.find((c) => c.method === 'eth_sendTransaction');
    expect(sent?.params).toEqual([
      { from: TOKEN.toLowerCase(), to: ESCROW.toLowerCase(), data: DEPOSIT_VEC, gas: DEPOSIT_GAS_LIMIT },
    ]);
  });

  it('gas limits are pinned hex with ~2x headroom (never estimated)', () => {
    expect(APPROVE_GAS_LIMIT).toBe('0x186a0');
    expect(BigInt(APPROVE_GAS_LIMIT)).toBe(100_000n);
    expect(DEPOSIT_GAS_LIMIT).toBe('0x30d40');
    expect(BigInt(DEPOSIT_GAS_LIMIT)).toBe(200_000n);
    expect(DISPUTE_GAS_LIMIT).toBe('0x186a0');
    expect(BigInt(DISPUTE_GAS_LIMIT)).toBe(100_000n);
  });

  it('gas addition leaves calldata byte-identical (encoder untouched)', async () => {
    const { provider, calls } = fakeProvider(() => TX);
    await approve(provider, { token: TOKEN, spender: ESCROW, amount: AMOUNT, from: TOKEN });
    await deposit(provider, { contract: ESCROW, escrowId: EID, amount: AMOUNT, from: TOKEN });
    const sends = calls.filter((c) => c.method === 'eth_sendTransaction');
    expect(sends).toHaveLength(2);
    expect((sends[0]?.params as Array<{ data: string }>)[0]?.data).toBe(APPROVE_VEC);
    expect((sends[1]?.params as Array<{ data: string }>)[0]?.data).toBe(DEPOSIT_VEC);
  });

  it('rejects malformed gas limits', () => {
    for (const bad of ['', '0x', '100000', '0xZZZ', '0x12 34']) {
      expect(() => normalizeGasLimit(bad)).toThrow();
    }
    expect(normalizeGasLimit('0x186A0')).toBe('0x186a0');
  });

  it('malformed wallet hash → EvmRpcError (never recorded)', async () => {
    const { provider } = fakeProvider(() => 'not-a-hash');
    await expect(
      sendTransaction(provider, { from: TOKEN, to: ESCROW, data: DEPOSIT_VEC, gas: DEPOSIT_GAS_LIMIT }),
    ).rejects.toThrow(EvmRpcError);
  });

  it('receipt resolves on status 1, throws on revert', async () => {
    const { provider } = fakeProvider(() => ({ status: '0x1', blockNumber: '0x10' }));
    await expect(waitForReceipt(provider, TX, { intervalMs: 1 })).resolves.toMatchObject({ status: '0x1' });
    const reverting = fakeProvider(() => ({ status: '0x0', blockNumber: '0x10' }));
    await expect(waitForReceipt(reverting.provider, TX, { intervalMs: 1 })).rejects.toThrow(EvmRpcError);
  });

  it('unknown tx past the timeout → ReceiptTimeoutError (re-poll, never re-send)', async () => {
    const { provider } = fakeProvider(() => null);
    await expect(waitForReceipt(provider, TX, { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(
      ReceiptTimeoutError,
    );
  });
});
