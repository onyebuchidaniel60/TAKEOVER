// Request-shape + client-validation unit tests (node).
// Round-2 Bug 1 class: mutations must always carry a JSON body, and apiFetch
// must only declare a JSON content type when a body exists.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  getSessionToken,
  setSessionToken,
} from '../src/lib/api';
import {
  cancelSlot,
  publishSlot,
  validateDisplayName,
  validateSlotEndsAt,
  validateSlotPrice,
  validateSlotQuantity,
  validateSlotStartsAt,
  validateSlotTitle,
} from '../src/lib/slots';
import { useAuth } from '../src/store/auth';

// Database-free: fetch is stubbed, sessionStorage is stubbed.
function installSessionStorage(): void {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (k: string): string | null => backing.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        backing.set(k, v);
      },
      removeItem: (k: string): void => {
        backing.delete(k);
      },
    },
    configurable: true,
  });
}

function stubFetchOk(): { seen: RequestInit[]; urls: unknown[] } {
  const seen: RequestInit[] = [];
  const urls: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    (async (url: unknown, init?: RequestInit) => {
      urls.push(url);
      seen.push(init ?? {});
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: { ok: true }, requestId: 'test' }),
      } as unknown as Response;
    }) as typeof fetch,
  );
  return { seen, urls };
}

describe('request bodies (fix A)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installSessionStorage();
    setSessionToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionToken(null);
  });

  it('apiFetch omits Content-Type when no body is provided', async () => {
    const { seen } = stubFetchOk();
    await apiFetch('/api/v1/me');
    await apiFetch('/api/v1/slots/x/publish', { method: 'POST' });
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['content-type']).toBeUndefined();
      expect(init.body).toBeUndefined();
    }
  });

  it('apiFetch includes Content-Type: application/json when a body is provided', async () => {
    const { seen } = stubFetchOk();
    await apiFetch('/api/v1/slots/x/claims', { method: 'POST', body: JSON.stringify({}) });
    const headers = (seen[0]?.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('apiFetch still attaches Authorization when a token is present', async () => {
    setSessionToken('sess-9.xyz');
    const { seen } = stubFetchOk();
    await apiFetch('/api/v1/me');
    expect((seen[0]?.headers as Record<string, string>)['authorization']).toBe('Bearer sess-9.xyz');
  });

  it('publishSlot and cancelSlot send a non-empty JSON body', async () => {
    const { seen } = stubFetchOk();
    await publishSlot('slot-1');
    await cancelSlot('slot-1');
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['content-type']).toBe('application/json');
      expect(typeof init.body).toBe('string');
      expect((init.body as string).length).toBeGreaterThan(0);
      expect(() => JSON.parse(init.body as string)).not.toThrow();
    }
  });

  it('logout sends a JSON body and clears the stored token', async () => {
    setSessionToken('sess-10.abc');
    const { seen } = stubFetchOk();
    await useAuth.getState().logout();
    expect(seen).toHaveLength(1);
    expect(typeof seen[0]?.body).toBe('string');
    expect((seen[0]?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(getSessionToken()).toBeNull();
  });
});

describe('client-side validation mirrors (fix C)', () => {
  it('validateDisplayName mirrors providerProfileBodySchema', () => {
    expect(validateDisplayName('')).not.toBeNull();
    expect(validateDisplayName('   ')).not.toBeNull();
    expect(validateDisplayName('x')).not.toBeNull();
    expect(validateDisplayName('a'.repeat(61))).not.toBeNull();
    expect(validateDisplayName('eat at http://example.com daily')).toBe('Display name must not contain links.');
    expect(validateDisplayName('see www.example.com deals')).toBe('Display name must not contain links.');
    expect(validateDisplayName('Sunrise Yoga')).toBeNull();
    expect(validateDisplayName('  AB  ')).toBeNull();
    expect(validateDisplayName('example.com fan')).toBeNull(); // no rule against bare TLDs server-side
  });

  it('slot field validators mirror the publish gate', () => {
    const now = Date.parse('2026-09-15T00:00:00.000Z');
    expect(validateSlotTitle('')).not.toBeNull();
    expect(validateSlotTitle('   ')).not.toBeNull();
    expect(validateSlotTitle('Table for two')).toBeNull();
    expect(validateSlotStartsAt(undefined, now)).not.toBeNull();
    expect(validateSlotStartsAt('not-a-date', now)).not.toBeNull();
    expect(validateSlotStartsAt('2026-09-14T00:00:00.000Z', now)).toBe('Start must be in the future.');
    expect(validateSlotStartsAt('2026-09-16T00:00:00.000Z', now)).toBeNull();
    expect(validateSlotEndsAt('2026-09-16T10:00:00.000Z', '')).toBeNull();
    expect(validateSlotEndsAt('2026-09-16T10:00:00.000Z', '2026-09-16T09:00:00.000Z')).toBe(
      'End must be after the start.',
    );
    expect(validateSlotEndsAt('2026-09-16T10:00:00.000Z', 'garbage')).not.toBeNull();
    expect(validateSlotEndsAt('2026-09-16T10:00:00.000Z', '2026-09-16T11:00:00.000Z')).toBeNull();
    expect(validateSlotPrice('1')).toBeNull();
    expect(validateSlotPrice('0')).not.toBeNull();
    expect(validateSlotPrice('abc')).not.toBeNull();
    expect(validateSlotPrice('1.123456')).toBeNull();
    expect(validateSlotPrice('1.1234567')).not.toBeNull();
    expect(validateSlotQuantity('2')).toBeNull();
    expect(validateSlotQuantity('0')).not.toBeNull();
    expect(validateSlotQuantity('1.5')).not.toBeNull();
    expect(validateSlotQuantity('')).not.toBeNull();
  });
});
