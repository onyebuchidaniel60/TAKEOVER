// Phase 14d-3a: escrow signer module tests (no network, no DB).
// The signer is the first server-side private key in this project: loading
// is lazy + cached, failures are generic (never embed key material), and a
// source scan proves the key is never logged, returned, or stringified.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EscrowSignerUnavailableError,
  loadEscrowSigner,
  resetEscrowSignerCache,
} from '../src/escrow/polygon/signer';

// Throwaway test vector (locally generated random key; not a secret, never
// deployed, never funded). Address derived with viem at authoring time.
const DEV_KEY = '0x7d55f2055b8df473b591f640d1d6adfabeab1960ff7eb6dca603eb3fdae531c5';
const DEV_ADDRESS = '0x49a67b64d652eee55e1f35469c27782aed18d4c2';

describe('escrow signer loading', () => {
  it('missing key → EscrowSignerUnavailableError', () => {
    resetEscrowSignerCache();
    expect(() => loadEscrowSigner({})).toThrow(EscrowSignerUnavailableError);
    expect(() => loadEscrowSigner({ ESCROW_SIGNER_PRIVATE_KEY: '' })).toThrow(
      EscrowSignerUnavailableError,
    );
  });

  it('malformed key → EscrowSignerUnavailableError', () => {
    resetEscrowSignerCache();
    for (const bad of ['not-a-key', '0x1234', `0x${'zz'.repeat(32)}`, '0x', '  ']) {
      expect(() => loadEscrowSigner({ ESCROW_SIGNER_PRIVATE_KEY: bad })).toThrow(
        EscrowSignerUnavailableError,
      );
    }
  });

  it('address mismatch → EscrowSignerUnavailableError', () => {
    resetEscrowSignerCache();
    expect(() =>
      loadEscrowSigner({
        ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY,
        ESCROW_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000001',
      }),
    ).toThrow(EscrowSignerUnavailableError);
  });

  it('valid key derives the expected address and caches the account', () => {
    resetEscrowSignerCache();
    const first = loadEscrowSigner({
      ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY,
      ESCROW_SIGNER_ADDRESS: DEV_ADDRESS,
    });
    expect(first.address.toLowerCase()).toBe(DEV_ADDRESS);
    const second = loadEscrowSigner({
      ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY,
      ESCROW_SIGNER_ADDRESS: DEV_ADDRESS,
    });
    expect(second).toBe(first);
  });

  it('bare 64-hex key (no 0x) is accepted', () => {
    resetEscrowSignerCache();
    const account = loadEscrowSigner({ ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY.slice(2) });
    expect(account.address.toLowerCase()).toBe(DEV_ADDRESS);
  });

  it('error messages never embed key material', () => {
    resetEscrowSignerCache();
    const failures: unknown[] = [];
    try {
      loadEscrowSigner({ ESCROW_SIGNER_PRIVATE_KEY: '0xdead' });
    } catch (err) {
      failures.push(err);
    }
    try {
      loadEscrowSigner({
        ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY,
        ESCROW_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000001',
      });
    } catch (err) {
      failures.push(err);
    }
    expect(failures).toHaveLength(2);
    for (const err of failures) {
      const message = (err as Error).message;
      expect(message).not.toContain('ac0974');
      expect(message).not.toContain('dead');
      expect(message).not.toContain('0x');
    }
  });

  it('the account object never exposes the private key (source scan + shape)', () => {
    resetEscrowSignerCache();
    const account = loadEscrowSigner({ ESCROW_SIGNER_PRIVATE_KEY: DEV_KEY });
    expect('privateKey' in (account as unknown as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(account)).not.toContain('ac0974bec39a17e36ba4af0bdcb4ecb042');
    const source = readFileSync(
      join(process.cwd(), 'src', 'escrow', 'polygon', 'signer.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\.log\(/);
    expect(source).not.toMatch(/JSON\.stringify\(account/);
    expect(source).not.toMatch(/JSON\.stringify\(raw/);
    expect(source).not.toMatch(/return raw/);
  });
});
