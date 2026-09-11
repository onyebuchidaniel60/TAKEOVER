// Phase 8 frontend tests — no backend, no wallet. Covers the pure
// poll-scheduling helper and the verify-payment client (fetch stubbed),
// including Retry-After propagation for the 429 backoff path.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import {
  nextVerifyPollDelayMs,
  VERIFY_POLL_INTERVAL_MS,
  VERIFY_POLL_MAX_ATTEMPTS,
  VERIFY_POLL_RATE_LIMIT_BACKOFF_MS,
  VERIFY_POLL_RPC_BACKOFF_MS,
  verifyPayment,
} from '../src/lib/slots';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextVerifyPollDelayMs', () => {
  it('stops polling on terminal outcomes', () => {
    expect(nextVerifyPollDelayMs('verified')).toBeNull();
    expect(nextVerifyPollDelayMs('review')).toBeNull();
  });

  it('polls every 5 seconds while pending', () => {
    expect(nextVerifyPollDelayMs('pending')).toBe(VERIFY_POLL_INTERVAL_MS);
    expect(VERIFY_POLL_INTERVAL_MS).toBe(5_000);
  });

  it('backs off to 15 seconds on RPC outages', () => {
    expect(nextVerifyPollDelayMs('rpc-unavailable')).toBe(VERIFY_POLL_RPC_BACKOFF_MS);
    expect(VERIFY_POLL_RPC_BACKOFF_MS).toBe(15_000);
  });

  it('respects Retry-After on rate limits, else backs off to 10 seconds', () => {
    expect(nextVerifyPollDelayMs('rate-limited', 4_000)).toBe(4_000);
    expect(nextVerifyPollDelayMs('rate-limited')).toBe(VERIFY_POLL_RATE_LIMIT_BACKOFF_MS);
    expect(nextVerifyPollDelayMs('rate-limited', Number.NaN)).toBe(
      VERIFY_POLL_RATE_LIMIT_BACKOFF_MS,
    );
    expect(VERIFY_POLL_RATE_LIMIT_BACKOFF_MS).toBe(10_000);
  });

  it('caps auto-polling at 60 attempts', () => {
    expect(VERIFY_POLL_MAX_ATTEMPTS).toBe(60);
  });
});

describe('verifyPayment client', () => {
  const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';

  function stubFetch(res: {
    ok: boolean;
    status: number;
    headers: Record<string, string | null>;
    body: unknown;
  }): { calls: Array<{ url: string; init?: RequestInit }> } {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: res.ok,
        status: res.status,
        headers: { get: (name: string) => res.headers[name.toLowerCase()] ?? null },
        json: async () => res.body,
      };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    return { calls };
  }

  it('posts an empty body and returns the verification shape', async () => {
    const { calls } = stubFetch({
      ok: true,
      status: 200,
      headers: {},
      body: {
        data: {
          claim: { id: CLAIM_ID },
          intent: { claimId: CLAIM_ID },
          verification: { status: 'pending', confirmations: 2 },
        },
      },
    });
    const result = await verifyPayment(CLAIM_ID);
    expect(result.verification).toEqual({ status: 'pending', confirmations: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/v1/claims/${CLAIM_ID}/verify-payment`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{}');
  });

  it('propagates Retry-After as retryAfterMs on 429', async () => {
    stubFetch({
      ok: false,
      status: 429,
      headers: { 'retry-after': '4' },
      body: { error: { code: 'VERIFY_RATE_LIMITED', message: 'Slow down.' } },
    });
    const err = await verifyPayment(CLAIM_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VERIFY_RATE_LIMITED');
    expect((err as ApiError).retryAfterMs).toBe(4_000);
  });
});
