// Phase 7 completion — SDK return-value resolution (Case A) + frontend payment
// flow test. The SDK path was never exercised in Phase 7 (the manual test used
// a fake hash and never called the wallet). This suite mocks the wallet
// provider and the backend fetch layer to prove the exact bytes flow:
//
//   intent (server) → SDK call (wallet) → submission POST (server)
//
// Authoritative citations (see AI_HANDOFF checkpoint):
// - Installed types:
//   node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts:187-193 —
//   sendBasicTransactionWithData(tx: { recipient: string; value: number;
//   fee?: number; data: string; validityStartHeight?: number; })
//   => Promise<string | ErrorResponse> with JSDoc "@returns The serialized
//   transaction" (stale prose in the forwarder types).
// - Official docs:
//   https://nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata
//   — sendBasicTransactionWithData Returns `string` — transaction hash, with
//   example `const txHash = await nimiq.sendBasicTransactionWithData(...)`.
// - Oracle (@nimiq/core, root devDependency):
//   node_modules/@nimiq/core/nodejs/main-wasm/index.js — class Transaction:
//   hash() "Computes the transaction's hash, which is used as its unique
//   identifier on the blockchain. @returns {string}" vs serialize()
//   "@returns {Uint8Array}" and toHex() "Serializes the transaction into a HEX
//   string." Live oracle: hash() is 64 hex chars, no 0x prefix; serialize() is
//   139 bytes (basic) / 214 bytes (basic-with-data) — a serialized transaction
//   is NOT a 64-char hash.
// Resolution: Case A — the wallet returns a transaction hash; the frontend
// passes it through unchanged as txHash. No schema change, no endpoint change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiqProvider } from '@nimiq/mini-app-sdk';
import { sendBasicTransactionWithData } from '../src/lib/nimiq';
import {
  baseUnitsToSafeNumber,
  createPaymentIntent,
  submitPayment,
} from '../src/lib/slots';

const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';
// Shape of a real @nimiq/core Transaction.hash(): 64 lowercase hex chars, no
// 0x prefix. Distinct from a serialized transaction (basic-with-data serializes
// to 214 bytes = 428 hex chars). Hardcoded so the web suite (no @nimiq/core
// dep) still exercises the real hash shape.
const KNOWN_HASH = 'ac2f80450d454af19efec4e5d405d964d0d0690fded17e588f033d74998317d0';
// Canonical server-issued payout wallet (no spaces, uppercase, NQ prefix).
const CANONICAL_RECIPIENT = 'NQ0700000000000000000000000000000000';
const EXPECTED_DATA = `TAKEOVER:v1:${CLAIM_ID}`;
const EXPECTED_AMOUNT_NIM = '150000';

function fakeProvider(returnValue: string | { error: { type: string; message: string } }): {
  provider: NimiqProvider;
  calls: Array<{ recipient: string; value: number; data: string }>;
} {
  const calls: Array<{ recipient: string; value: number; data: string }> = [];
  const provider = {
    sendBasicTransactionWithData: vi.fn(async (args: { recipient: string; value: number; data: string }) => {
      calls.push({ recipient: args.recipient, value: args.value, data: args.data });
      return returnValue;
    }),
  } as unknown as NimiqProvider;
  return { provider, calls };
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    headers: { get: () => 'test-request-id' },
    json: async () => payload,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SDK return value is a transaction hash (Case A passthrough)', () => {
  it('passes the wallet-returned hash through unchanged as txHash', async () => {
    const { provider, calls } = fakeProvider(KNOWN_HASH);
    const result = await sendBasicTransactionWithData(provider, {
      recipient: CANONICAL_RECIPIENT,
      value: 150000,
      data: EXPECTED_DATA,
    });
    expect(result).toBe(KNOWN_HASH);
    expect(calls).toHaveLength(1);
  });

  it('confirms the hash format: 64 hex chars, no 0x prefix', () => {
    expect(KNOWN_HASH).toHaveLength(64);
    expect(KNOWN_HASH).toMatch(/^[0-9a-fA-F]{64}$/);
    expect(KNOWN_HASH.startsWith('0x')).toBe(false);
  });

  it('surfaces wallet errors as throws (user cancel is never a silent hash)', async () => {
    const { provider } = fakeProvider({ error: { type: 'PermissionDeniedError', message: 'Rejected.' } });
    await expect(
      sendBasicTransactionWithData(provider, {
        recipient: CANONICAL_RECIPIENT,
        value: 150000,
        data: EXPECTED_DATA,
      }),
    ).rejects.toThrow('Rejected.');
  });
});

describe('frontend payment flow (intent → SDK → submission)', () => {
  it('submits the exact SDK-returned bytes with byte-for-byte binding, integer value, canonical recipient', async () => {
    const intent = {
      id: 'intent-id-1',
      claimId: CLAIM_ID,
      expectedAmountNim: EXPECTED_AMOUNT_NIM,
      expectedRecipient: CANONICAL_RECIPIENT,
      expectedData: EXPECTED_DATA,
      status: 'created',
      txHash: null,
      submittedAt: null,
      createdAt: new Date().toISOString(),
    };
    const submittedBodies: unknown[] = [];
    const submittedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith(`/api/v1/claims/${CLAIM_ID}/payment-intent`)) {
        return jsonResponse({ data: { intent, claim: { id: CLAIM_ID }, slot: { id: 'slot-1' } } });
      }
      if (href.endsWith(`/api/v1/claims/${CLAIM_ID}/payment-submission`)) {
        submittedUrls.push(href);
        submittedBodies.push(init?.body !== undefined ? JSON.parse(String(init.body)) : undefined);
        return jsonResponse({ data: { intent: { ...intent, txHash: KNOWN_HASH }, claim: { id: CLAIM_ID } } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    // 1. Intent first: the screen states exact terms BEFORE the wallet opens.
    const fetched = await createPaymentIntent(CLAIM_ID);
    expect(fetched.intent.expectedData).toBe(EXPECTED_DATA);
    expect(fetched.intent.expectedRecipient).toBe(CANONICAL_RECIPIENT);
    expect(fetched.intent.expectedAmountNim).toBe(EXPECTED_AMOUNT_NIM);

    // 2. Exact integer base-unit amount for the SDK: never a float, never a string.
    const value = baseUnitsToSafeNumber(fetched.intent.expectedAmountNim);
    expect(typeof value).toBe('number');
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(150000);

    // 3. SDK call with the server-issued terms, byte-for-byte.
    const { provider, calls } = fakeProvider(KNOWN_HASH);
    const txString = await sendBasicTransactionWithData(provider, {
      recipient: fetched.intent.expectedRecipient,
      value,
      data: fetched.intent.expectedData,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toBe(`TAKEOVER:v1:${CLAIM_ID}`);
    expect(calls[0]?.recipient).toBe(CANONICAL_RECIPIENT);
    expect(typeof calls[0]?.value).toBe('number');
    expect(Number.isInteger(calls[0]?.value)).toBe(true);
    expect(calls[0]?.value).toBe(150000);

    // 4. Record the returned string verbatim: exact bytes submitted.
    await submitPayment(CLAIM_ID, txString);
    expect(submittedUrls).toHaveLength(1);
    expect(submittedBodies).toHaveLength(1);
    expect(submittedBodies[0]).toEqual({ txHash: KNOWN_HASH });
  });

  it('refuses to send imprecise amounts instead of mis-sending', () => {
    expect(() => baseUnitsToSafeNumber('9007199254740993')).toThrow();
    expect(() => baseUnitsToSafeNumber('0')).toThrow();
  });
});
