// Phase 14f P-NIM-1: NIM escrow unit tests (no DB, no network).
// Covers the pure deposit predicate, the wallet address resolver, the
// ledger helper validation, and the balance-read parsing (mocked fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { type LedgerTx, buyerLedgerAccount, LEDGER_ESCROW_WALLET_ACCOUNT, providerLedgerAccount, writeLedgerEntry } from '../src/escrow/ledger';
import { EscrowWalletUnavailableError, resolveNimEscrowWalletAddress } from '../src/escrow/nimiq/wallet';
import { assessNimDeposit, nimDepositDataBinding } from '../src/escrow/nimiq/verify-deposit';
import { createRpcClient, type TxRecord } from '../src/payments/rpc';

function validAddress(seedByte: number): string {
  return deriveNimiqAddress(new Uint8Array(32).fill(seedByte));
}

const BUYER = validAddress(7);
const ESCROW_WALLET = validAddress(42);
const CLAIM_ID = '11111111-2222-4333-8444-555555555555';
const BINDING = nimDepositDataBinding(CLAIM_ID);
const DEPOSIT_HASH = 'ab'.repeat(32);

function txRecord(overrides: Partial<TxRecord> = {}): TxRecord {
  return {
    hash: DEPOSIT_HASH,
    sender: BUYER,
    recipient: ESCROW_WALLET,
    value: '1500000',
    data: BINDING,
    confirmations: 5,
    blockNumber: 11_000_000,
    ...overrides,
  };
}

function expectation(overrides: object = {}) {
  return {
    claimId: CLAIM_ID,
    buyerWallet: BUYER,
    escrowWallet: ESCROW_WALLET,
    amountBaseUnits: 1500000n,
    depositTxHash: DEPOSIT_HASH,
    ...overrides,
  };
}

describe('nimDepositDataBinding', () => {
  it('formats the TAKEOVER binding for the claim', () => {
    expect(nimDepositDataBinding(CLAIM_ID)).toBe(`TAKEOVER:v1:${CLAIM_ID}`);
  });
});

describe('assessNimDeposit', () => {
  it('unknown hash (null tx) → pending with no write signal', () => {
    expect(assessNimDeposit(null, expectation())).toEqual({ status: 'pending' });
  });

  it('exact match at policy → funded', () => {
    const out = assessNimDeposit(txRecord(), expectation());
    expect(out.status).toBe('funded');
    if (out.status === 'funded') expect(out.confirmations).toBe(5);
  });

  it('foreign sender → sender_mismatch (D5 sender binding)', () => {
    const out = assessNimDeposit(txRecord({ sender: validAddress(9) }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'sender_mismatch' });
  });

  it('malformed sender → sender_mismatch, never a throw', () => {
    const out = assessNimDeposit(txRecord({ sender: 'not-an-address' }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'sender_mismatch' });
  });

  it('wrong recipient → recipient_mismatch', () => {
    const out = assessNimDeposit(txRecord({ recipient: validAddress(11) }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'recipient_mismatch' });
  });

  it('wrong amount → amount_mismatch (BigInt-exact)', () => {
    const out = assessNimDeposit(txRecord({ value: '1500001' }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'amount_mismatch' });
  });

  it('non-integer amount → amount_mismatch, never a throw', () => {
    const out = assessNimDeposit(txRecord({ value: '1.5' }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'amount_mismatch' });
  });

  it('wrong data → data_mismatch', () => {
    const out = assessNimDeposit(txRecord({ data: 'TAKEOVER:v1:wrong-claim' }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'data_mismatch' });
  });

  it('under-confirmations → pending', () => {
    expect(assessNimDeposit(txRecord({ confirmations: 2 }), expectation()).status).toBe('pending');
  });

  it('null confirmations → pending (no evidence, never funded)', () => {
    expect(assessNimDeposit(txRecord({ confirmations: null }), expectation()).status).toBe('pending');
  });

  it('returned hash differs from the submitted reference → hash_mismatch', () => {
    const out = assessNimDeposit(txRecord({ hash: 'cd'.repeat(32) }), expectation());
    expect(out).toMatchObject({ status: 'mismatch', reason: 'hash_mismatch' });
  });

  it('malformed server terms → throw (programmer error, not a mismatch)', () => {
    expect(() => assessNimDeposit(txRecord(), expectation({ buyerWallet: 'bogus' }))).toThrow();
  });
});

describe('resolveNimEscrowWalletAddress', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.NIM_ESCROW_WALLET_ADDRESS = process.env.NIM_ESCROW_WALLET_ADDRESS;
  });

  afterEach(() => {
    if (saved.NIM_ESCROW_WALLET_ADDRESS === undefined) {
      delete process.env.NIM_ESCROW_WALLET_ADDRESS;
    } else {
      process.env.NIM_ESCROW_WALLET_ADDRESS = saved.NIM_ESCROW_WALLET_ADDRESS;
    }
  });

  it('missing → EscrowWalletUnavailableError', () => {
    delete process.env.NIM_ESCROW_WALLET_ADDRESS;
    expect(() => resolveNimEscrowWalletAddress()).toThrow(EscrowWalletUnavailableError);
  });

  it('blank → EscrowWalletUnavailableError', () => {
    process.env.NIM_ESCROW_WALLET_ADDRESS = '   ';
    expect(() => resolveNimEscrowWalletAddress()).toThrow(EscrowWalletUnavailableError);
  });

  it('malformed → EscrowWalletUnavailableError', () => {
    process.env.NIM_ESCROW_WALLET_ADDRESS = 'not-an-address';
    expect(() => resolveNimEscrowWalletAddress()).toThrow(EscrowWalletUnavailableError);
  });

  it('valid address → canonical form', () => {
    process.env.NIM_ESCROW_WALLET_ADDRESS = ESCROW_WALLET;
    expect(resolveNimEscrowWalletAddress()).toBe(ESCROW_WALLET);
  });
});

describe('ledger accounts + writeLedgerEntry validation (mocked tx)', () => {
  it('account naming convention', () => {
    expect(LEDGER_ESCROW_WALLET_ACCOUNT).toBe('escrow:wallet');
    expect(buyerLedgerAccount('user-1')).toBe('buyer:user:user-1');
    expect(providerLedgerAccount('user-2')).toBe('provider:user:user-2');
  });

  function mockTx(captured: unknown[]): LedgerTx {
    return {
      insert: () => ({
        values: (v: unknown) => {
          captured.push(v);
          return Promise.resolve([]);
        },
      }),
    } as unknown as LedgerTx;
  }

  const valid = {
    escrowId: '33333333-2222-4333-8444-555555555555',
    entryType: 'deposit' as const,
    debitAccount: buyerLedgerAccount('buyer-1'),
    creditAccount: LEDGER_ESCROW_WALLET_ACCOUNT,
    amountBaseUnits: 1500000n,
    txHash: DEPOSIT_HASH,
  };

  it('accepts a valid deposit row with exact fields', async () => {
    const captured: unknown[] = [];
    await writeLedgerEntry(mockTx(captured), valid);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      escrowId: valid.escrowId,
      entryType: 'deposit',
      debitAccount: 'buyer:user:buyer-1',
      creditAccount: 'escrow:wallet',
      amountBaseUnits: 1500000n,
      txHash: DEPOSIT_HASH,
    });
  });

  it.each([['bogus' as never], ['DEPOSIT' as never], ['' as never]])(
    'rejects invalid entry type (%s)',
    async (entryType) => {
      const captured: unknown[] = [];
      await expect(writeLedgerEntry(mockTx(captured), { ...valid, entryType })).rejects.toThrow();
      expect(captured).toHaveLength(0);
    },
  );

  it.each([[0n], [-5n]])('rejects non-positive amount (%s)', async (amountBaseUnits) => {
    const captured: unknown[] = [];
    await expect(writeLedgerEntry(mockTx(captured), { ...valid, amountBaseUnits })).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it.each([[''], ['   ']])('rejects empty transaction hash', async (txHash) => {
    const captured: unknown[] = [];
    await expect(writeLedgerEntry(mockTx(captured), { ...valid, txHash })).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });
});

describe('getBalance parsing (mocked JSON-RPC)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, httpStatus = 200): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: httpStatus >= 200 && httpStatus < 300,
        status: httpStatus,
        json: async () => body,
      })),
    );
  }

  it('numeric balance → decimal string', async () => {
    stubFetch({ jsonrpc: '2.0', result: { data: 12345, metadata: null }, id: 1 });
    await expect(createRpcClient('http://127.0.0.1:9').getBalance(BUYER)).resolves.toBe('12345');
  });

  it('decimal-string balance passes through normalized', async () => {
    stubFetch({ jsonrpc: '2.0', result: { data: '999', metadata: null }, id: 1 });
    await expect(createRpcClient('http://127.0.0.1:9').getBalance(BUYER)).resolves.toBe('999');
  });

  it('proxy rejection ("Method not allowed") → RpcUnavailableError', async () => {
    stubFetch({ jsonrpc: '2.0', error: 'Method not allowed', id: 1 });
    await expect(createRpcClient('http://127.0.0.1:9').getBalance(BUYER)).rejects.toThrow(
      'Nimiq RPC error (code ?).',
    );
  });

  it('malformed balance → RpcUnavailableError', async () => {
    stubFetch({ jsonrpc: '2.0', result: { data: 'twelve', metadata: null }, id: 1 });
    await expect(createRpcClient('http://127.0.0.1:9').getBalance(BUYER)).rejects.toThrow(
      'Nimiq RPC returned a malformed balance.',
    );
  });

  it('HTTP error → RpcUnavailableError', async () => {
    stubFetch({ error: 'x' }, 500);
    await expect(createRpcClient('http://127.0.0.1:9').getBalance(BUYER)).rejects.toThrow(
      'Nimiq RPC responded with HTTP 500.',
    );
  });
});
