// live RPC smoke test — hits the REAL Nimiq network. Purpose: catch
// RPC schema drift (if the public endpoint changes its getTransactionByHash
// shape, this fails loudly). Uses a known settled mainnet transaction mined
// in block 61350291 (observed 2026-09-11, a "You mined NIM on Nimiq.Space!"
// payout — small, old, permanently confirmable). If this test is flaky or
// fails against the public RPC, REPORT the failure — never delete the test.
import { describe, expect, it } from 'vitest';
import { createRpcClient, getNimiqRpcUrl } from '../src/payments/rpc';

const KNOWN_HASH = '51756c4ec6680f0c26ba55d5a2e7ba9775af8c6d9c2bf25633cf33e1cfb58b6e';

describe('live Nimiq RPC smoke (real network)', () => {
  it(
    'parses a known settled transaction into a TxRecord',
    { timeout: 30_000 },
    async () => {
      const rpc = createRpcClient(getNimiqRpcUrl());
      const tx = await rpc.getTransactionByHash(KNOWN_HASH);
      expect(tx).not.toBeNull();
      expect(tx!.hash.toLowerCase()).toBe(KNOWN_HASH);
      expect(tx!.sender).toMatch(/^NQ/);
      expect(tx!.recipient).toMatch(/^NQ/);
      expect(tx!.value).toBe('99847');
      expect(tx!.data).toBe('You mined NIM on Nimiq.Space!');
      expect(tx!.blockNumber).toBe(61350291);
      expect(tx!.confirmations).not.toBeNull();
      expect(tx!.confirmations!).toBeGreaterThanOrEqual(3);
    },
  );

  it(
    'exposes the chain head height past the known block',
    { timeout: 30_000 },
    async () => {
      const rpc = createRpcClient(getNimiqRpcUrl());
      const head = await rpc.getBlockNumber();
      expect(head).toBeGreaterThan(61350291);
    },
  );
});
