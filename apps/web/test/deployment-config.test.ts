// Deployment wiring — VITE_API_BASE_URL + VITE_DEBUG_PAYMENTS.
// The production frontend (Vercel) must reach the production backend (Railway),
// so apiFetch resolves every path against VITE_API_BASE_URL when set and keeps
// same-origin relative paths when unset (local dev via the Vite /api proxy).
// Payment diagnostics stay OFF unless explicitly enabled, and never expose
// session tokens, cookie values, or full wallet addresses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, apiFetch } from '../src/lib/api';
import {
  debugPaymentsLog,
  isDebugPaymentsEnabled,
  PAYMENTS_DEBUG_PREFIX,
  redactIntentForLog,
  redactSdkArgsForLog,
} from '../src/lib/debug-payments';

const RAILWAY_URL = 'https://takeover-api-test.up.railway.app';
const CANONICAL_RECIPIENT = 'NQ0700000000000000000000000000000000';
const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    headers: { get: () => null },
    json: async () => payload,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Genuinely unset (not blank): delete the property instead of stubbing. */
function clearEnv(name: string): void {
  delete (import.meta.env as unknown as Record<string, unknown>)[name];
}

describe('apiBaseUrl', () => {
  it('defaults to empty string (same-origin relative paths) when unset', () => {
    clearEnv('VITE_API_BASE_URL');
    expect(apiBaseUrl()).toBe('');
  });

  it('treats a blank value as unset', () => {
    vi.stubEnv('VITE_API_BASE_URL', '   ');
    expect(apiBaseUrl()).toBe('');
  });

  it('passes a Railway URL through and strips a trailing slash', () => {
    vi.stubEnv('VITE_API_BASE_URL', `${RAILWAY_URL}/`);
    expect(apiBaseUrl()).toBe(RAILWAY_URL);
  });
});

describe('apiFetch base URL', () => {
  it('calls the same-origin path when the base URL is unset (dev behavior)', async () => {
    clearEnv('VITE_API_BASE_URL');
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        seen.push(String(url));
        return jsonResponse({ data: { ok: true } });
      }) as unknown as typeof fetch,
    );
    await apiFetch('/api/v1/slots');
    expect(seen).toEqual(['/api/v1/slots']);
  });

  it('prefixes the Railway URL when the base URL is set (production behavior)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', RAILWAY_URL);
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        seen.push(String(url));
        return jsonResponse({ data: { ok: true } });
      }) as unknown as typeof fetch,
    );
    await apiFetch('/api/v1/slots');
    expect(seen).toEqual([`${RAILWAY_URL}/api/v1/slots`]);
  });
});

describe('VITE_DEBUG_PAYMENTS', () => {
  it('defaults to false unless explicitly set to "true"', () => {
    clearEnv('VITE_DEBUG_PAYMENTS');
    expect(isDebugPaymentsEnabled()).toBe(false);
  });

  it('stays false for any value other than exactly "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', ' true ', 'false', '']) {
      vi.stubEnv('VITE_DEBUG_PAYMENTS', value);
      expect(isDebugPaymentsEnabled()).toBe(false);
    }
  });

  it('is true when explicitly set to "true"', () => {
    vi.stubEnv('VITE_DEBUG_PAYMENTS', 'true');
    expect(isDebugPaymentsEnabled()).toBe(true);
  });

  it('logs nothing while disabled', () => {
    clearEnv('VITE_DEBUG_PAYMENTS');
    const info = vi.fn();
    vi.stubGlobal('console', { ...console, info } as unknown as typeof console);
    debugPaymentsLog('intent received', { amount: '100000' });
    debugPaymentsLog('sdk returned');
    expect(info).not.toHaveBeenCalled();
  });

  it('logs with the debug prefix while enabled', () => {
    vi.stubEnv('VITE_DEBUG_PAYMENTS', 'true');
    const info = vi.fn();
    vi.stubGlobal('console', { ...console, info } as unknown as typeof console);
    debugPaymentsLog('sdk returned', 'ac2f');
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain(PAYMENTS_DEBUG_PREFIX);
    expect(info.mock.calls[0]?.[1]).toBe('ac2f');
  });
});

describe('payment debug redaction', () => {
  it('shows amount + data verbatim, truncates the recipient, redacts the tx hash', () => {
    const view = redactIntentForLog({
      expectedAmountNim: '100000',
      expectedRecipient: CANONICAL_RECIPIENT,
      expectedData: `TAKEOVER:v1:${CLAIM_ID}`,
      txHash: 'ac2f80450d454af19efec4e5d405d964d0d0690fded17e588f033d74998317d0',
    });
    expect(view.amount).toBe('100000');
    expect(view.data).toBe(`TAKEOVER:v1:${CLAIM_ID}`);
    expect(view.txHash).toBe('<redacted>');
    // Truncated display form only — the full wallet address never appears.
    expect(view.recipient).toBe('NQ07…0000');
    expect(JSON.stringify(view)).not.toContain(CANONICAL_RECIPIENT);
  });

  it('preserves a null tx hash as null', () => {
    const view = redactIntentForLog({
      expectedAmountNim: '100000',
      expectedRecipient: CANONICAL_RECIPIENT,
      expectedData: `TAKEOVER:v1:${CLAIM_ID}`,
      txHash: null,
    });
    expect(view.txHash).toBeNull();
  });

  it('logs SDK value + data verbatim with a truncated recipient', () => {
    const view = redactSdkArgsForLog({
      recipient: CANONICAL_RECIPIENT,
      value: 100000,
      data: `TAKEOVER:v1:${CLAIM_ID}`,
    });
    expect(view.value).toBe(100000);
    expect(view.data).toBe(`TAKEOVER:v1:${CLAIM_ID}`);
    expect(view.recipient).toBe('NQ07…0000');
    expect(JSON.stringify(view)).not.toContain(CANONICAL_RECIPIENT);
  });
});
