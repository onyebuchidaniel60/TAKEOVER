// Shared DOM-test harness (jsdom). Renders routes with a stubbed
// fetch layer and a directly-set auth store — no backend, no wallet.
// a11y tool choice: axe-core run directly (NOT @axe-core/playwright,
// NOT vitest-axe). vitest-axe resolves vitest 5, which conflicts with this
// repo's pinned vitest 2 + vite 5; @axe-core/playwright needs downloaded
// browsers, unavailable here. axe-core in jsdom gives the same engine
// deterministically inside `npm run test`. color-contrast is excluded from
// the jsdom run (jsdom cannot compute styles) and measured separately with
// exact palette math — see the palette table in apps/web/tailwind.config.js.
import axe from 'axe-core';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useAuth } from '../src/store/auth';

afterEach(() => {
  cleanup();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
  viRestoreFetch();
});

type FetchHandler = (url: string, init?: RequestInit) => unknown;

let originalFetch: typeof fetch | undefined;

function viRestoreFetch(): void {
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Stub global fetch. Unmatched routes answer 404 UNKNOWN. A handler may
 * return a never-settling promise to hold a component in its loading state.
 */
export function mockFetch(handler: FetchHandler): void {
  if (originalFetch === undefined) {
    originalFetch = globalThis.fetch;
  }
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const body = handler(String(url), init);
    if (body instanceof Promise) {
      return body.then((resolved) => toResponse(resolved));
    }
    return Promise.resolve(toResponse(body));
  }) as typeof fetch;
}

function toResponse(body: unknown): Response {
  if (body !== undefined && typeof body === 'object' && body !== null && 'status' in body) {
    const { status, json } = body as { status: number; json: unknown };
    return jsonResponse(status, json);
  }
  return jsonResponse(200, { data: body });
}

/** A promise that never settles — keeps components in loading state. */
export function pendingForever(): Promise<never> {
  return new Promise<never>(() => {});
}

export function ok<T>(data: T): T {
  return data;
}

export function err(status: number, code: string, message: string): { status: number; json: unknown } {
  return { status, json: { error: { code, message }, requestId: 'test-request' } };
}

export function setGuest(): void {
  useAuth.setState({
    status: 'unauthenticated',
    user: null,
    error: null,
    initialized: true,
  });
}

export function setBuyer(): void {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'buyer-1', walletAddress: 'NQ0700000000000000000000000000000000', role: 'buyer', status: 'active' },
    error: null,
    initialized: true,
  });
}

export function setAdmin(): void {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'admin-1', walletAddress: 'NQ3200000000000000000000000000000000', role: 'admin', status: 'active' },
    error: null,
    initialized: true,
  });
}

// -- fixtures ---------------------------------------------------------------

const FUTURE = new Date(Date.now() + 2 * 3600_000).toISOString();
const LATER = new Date(Date.now() + 4 * 3600_000).toISOString();

export function slotFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'slot-1',
    title: 'Table for two — tonight',
    description: 'A cozy corner table.',
    category: 'dining',
    location_label: 'Mitte',
    starts_at: FUTURE,
    ends_at: LATER,
    price_usdt: '150000',
    total_quantity: 4,
    available_quantity: 3,
    status: 'published',
    published_at: new Date().toISOString(),
    providerDisplay: 'Manual Bistro',
    ...overrides,
  };
}

export function claimFixture(
  status = 'active_hold',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'claim-1',
    slot_id: 'slot-1',
    buyer_id: 'buyer-1',
    quantity: 1,
    status,
    hold_expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function intentFixture(): Record<string, unknown> {
  return {
    id: 'intent-1',
    claimId: 'claim-1',
    expectedAmountNim: '150000',
    expectedRecipient: 'NQ3200000000000000000000000000000000',
    expectedData: 'TAKEOVER:v1:claim-1',
    status: 'created',
    txHash: null,
    submittedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function meFixture(): Record<string, unknown> {
  return {
    id: 'buyer-1',
    walletAddress: 'NQ0700000000000000000000000000000000',
    role: 'buyer',
    status: 'active',
    hasProviderProfile: false,
    providerProfile: null,
  };
}

export function emptyCounts(): Record<string, number> {
  return { active_hold: 0, payment_pending: 0, paid: 0, payment_review: 0, expired: 0, cancelled: 0 };
}

// -- axe --------------------------------------------------------------------

export interface AxeTriage {
  critical: unknown[];
  serious: unknown[];
  moderate: unknown[];
  minor: unknown[];
}

export async function runAxe(element: Element): Promise<AxeTriage> {
  const results = await axe.run(element, {
    rules: {
      // jsdom cannot compute styles; contrast is measured separately with
      // exact palette math (see the palette table in apps/web/tailwind.config.js).
      'color-contrast': { enabled: false },
    },
  });
  const byImpact = (impact: string): unknown[] =>
    results.violations.filter((v) => v.impact === impact);
  return {
    critical: byImpact('critical'),
    serious: byImpact('serious'),
    moderate: byImpact('moderate'),
    minor: byImpact('minor'),
  };
}

export function assertZeroCriticalOrSerious(triage: AxeTriage, route: string): void {
  const problems = [...triage.critical, ...triage.serious];
  if (problems.length > 0) {
    throw new Error(
      `axe critical/serious violations on ${route}: ${JSON.stringify(problems, null, 2)}`,
    );
  }
}
