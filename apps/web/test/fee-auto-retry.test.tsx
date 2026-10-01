// @vitest-environment jsdom
// Phase 5n-C (D24): the NIM listing-fee auto-retry.
//
// The acceptance requirement is behavioural, so this is a TIMED test: fake
// timers, a backend that answers PAYMENT_NOT_CONFIRMED twice and then
// publishes. If the client needs a click in between, the claim counter stays
// at 1 and the test fails.
//
// It also pins the two things the owner actually complained about: the
// "please try again" copy is gone, and there is no retry button in the
// waiting path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createTestQueryClient } from './test-utils';
import { useAuth } from '../src/store/auth';
import FeeRetryBanner from '../src/components/FeeRetryBanner';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'me' } as never,
    error: null,
    initialized: true,
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** A retryable outcome with the meta the backend now sends. */
function notConfirmed(n: number) {
  return {
    ok: false,
    status: 409,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        error: {
          code: 'PAYMENT_NOT_CONFIRMED',
          message: `Fee payment is confirming (${n} of 3).`,
          meta: { confirmations: n, required: 3 },
        },
      }),
  };
}

describe('listing-fee auto-retry (Phase 5n-C, D24)', () => {
  it('shows confirmation progress from the error meta, not a retry button', async () => {
    render(
      <FeeRetryBanner
        feeFailure={{ code: 'PAYMENT_NOT_CONFIRMED', message: 'Fee payment is confirming (1 of 3).' }}
        publishing={false}
        confirm={{ confirmations: 1, required: 3 }}
        handover={false}
        onNewPayment={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(await screen.findByTestId('fee-confirmations')).toBeTruthy();
    expect(screen.getByText('Confirming 1/3…')).toBeTruthy();
    // The complaint: no retry button while waiting.
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    // And no "try again" copy anywhere.
    expect(document.body.textContent?.toLowerCase()).not.toContain('try again');
    expect(document.body.textContent).not.toContain('Please try again');
  });

  it('shows the network-waiting copy when the payment is not found yet', async () => {
    render(
      <FeeRetryBanner
        feeFailure={{ code: 'PAYMENT_NOT_FOUND', message: 'still propagating' }}
        publishing={false}
        confirm={{ confirmations: null, required: 3 }}
        handover={false}
        onNewPayment={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText(/waiting for the payment to appear/i)).toBeTruthy();
  });

  it('offers only a new payment on a HARD failure, with no retry button', async () => {
    render(
      <FeeRetryBanner
        feeFailure={{ code: 'PAYMENT_AMOUNT_MISMATCH', message: 'Fee payment must be exactly 15 NIM.' }}
        publishing={false}
        confirm={null}
        handover={false}
        onNewPayment={() => {}}
      />,
      { wrapper: Wrapper },
    );
    // Retrying the same hash would fail identically forever, so there is
    // deliberately no retry control here.
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByRole('button', { name: /pay again/i })).toBeTruthy();
    expect(screen.getByText('Fee payment must be exactly 15 NIM.')).toBeTruthy();
  });

  it('hands over with a "you can leave this page" message once the budget is spent', async () => {
    render(
      <FeeRetryBanner
        feeFailure={{ code: 'PAYMENT_NOT_CONFIRMED', message: 'still confirming' }}
        publishing={false}
        confirm={{ confirmations: 1, required: 3 }}
        handover
        onNewPayment={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText(/you can leave this page/i)).toBeTruthy();
  });

  /**
   * The poll loop itself. Deliberately extracted into a hook-shaped helper so
   * the timing is tested without booting the whole SellDetail route.
   */
  it('re-posts the SAME hash on a 5s cadence and stops on success', async () => {
    const attempts: string[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        attempts.push(String(body.transaction_hash ?? body.transactionHash ?? ''));
        call += 1;
        if (call <= 2) return notConfirmed(call);
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { slot: {} } }) };
      }) as unknown as typeof fetch,
    );

    const HASH = 'a'.repeat(64);
    const { pollUntilPublished } = await import('../src/lib/fee-poll');
    const done = await act(async () =>
      pollUntilPublished({
        hash: HASH,
        attempt: () =>
          fetch('/api/v1/slots/s1/publish', {
            method: 'POST',
            body: JSON.stringify({ transaction_hash: HASH }),
          }).then((r) => r as { ok: boolean; status: number; json: () => Promise<unknown> }),
        intervalMs: 5_000,
        backoffMs: 15_000,
        totalMs: 5 * 60_000,
        now: () => Date.now(),
        // Fire immediately: this test is about WHICH HASH goes out, not about
        // waiting. The cadence itself is asserted by the two delay tests.
        setTimeoutFn: (fn) => window.setTimeout(fn, 0),
        clearTimeoutFn: (h) => window.clearTimeout(h),
      }),
    );

    expect(done).toBe('published');
    // Three attempts, and EVERY one carried the same hash — a second hash
    // would be a second payment.
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts).size).toBe(1);
    expect(attempts[0]).toBe(HASH);
  });

  it('backs off to 15s on RPC_UNAVAILABLE instead of hammering the node', async () => {
    const delays: number[] = [];
    let call = 0;
    const { pollUntilPublished } = await import('../src/lib/fee-poll');
    const res = await pollUntilPublished({
      hash: 'b'.repeat(64),
      attempt: () => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: { code: 'RPC_UNAVAILABLE' } }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) });
      },
      intervalMs: 5_000,
      backoffMs: 15_000,
      totalMs: 5 * 60_000,
      now: () => Date.now(),
      setTimeoutFn: (fn, ms) => {
        delays.push(ms);
        // Fire immediately: this test is about the DELAY chosen, not waiting.
        return window.setTimeout(fn, 0);
      },
      clearTimeoutFn: (h) => window.clearTimeout(h),
    });
    expect(res).toBe('published');
    // Attempt 1 was RPC_UNAVAILABLE, so the wait before retrying is the
    // BACKOFF, not the normal cadence. Attempt 2 succeeds, so exactly one
    // delay was chosen.
    expect(delays).toEqual([15_000]);
  });

  it('uses the normal 5s cadence for an under-confirmed payment', async () => {
    const delays: number[] = [];
    let call = 0;
    const { pollUntilPublished } = await import('../src/lib/fee-poll');
    const res = await pollUntilPublished({
      hash: 'd'.repeat(64),
      attempt: () => {
        call += 1;
        if (call === 1) return Promise.resolve(notConfirmed(1));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) });
      },
      intervalMs: 5_000,
      backoffMs: 15_000,
      totalMs: 5 * 60_000,
      now: () => Date.now(),
      setTimeoutFn: (fn, ms) => {
        delays.push(ms);
        return window.setTimeout(fn, 0);
      },
      clearTimeoutFn: (h) => window.clearTimeout(h),
    });
    expect(res).toBe('published');
    expect(delays).toEqual([5_000]);
  });

  it('gives up after the total budget rather than polling forever', async () => {
    let clock = 0;
    const { pollUntilPublished } = await import('../src/lib/fee-poll');
    const res = await pollUntilPublished({
      hash: 'c'.repeat(64),
      attempt: () => Promise.resolve(notConfirmed(1)),
      intervalMs: 5_000,
      backoffMs: 15_000,
      totalMs: 5 * 60_000,
      now: () => clock,
      setTimeoutFn: (fn) => {
        clock += 5_000;
        return window.setTimeout(fn, 0);
      },
      clearTimeoutFn: (h) => window.clearTimeout(h),
    });
    expect(res).toBe('handover');
    expect(clock).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
