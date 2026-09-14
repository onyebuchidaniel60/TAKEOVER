// Phase 14c Bearer fallback — client storage and header wiring (node env,
// no DOM needed: sessionStorage is stubbed explicitly, including absence).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getSessionToken, SESSION_TOKEN_KEY, setSessionToken } from '../src/lib/api';

function installSessionStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  const stub = {
    getItem: (key: string): string | null => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
    removeItem: (key: string): void => {
      backing.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: stub, configurable: true });
  return backing;
}

function removeSessionStorage(): void {
  try {
    delete (globalThis as Record<string, unknown>).sessionStorage;
  } catch {
    // ignore — absence is the point
  }
}

function installThrowingLocalStorage(): { calls: number } {
  const state = { calls: 0 };
  const throwing = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'length' || prop === 'key') {
          return prop === 'length' ? 0 : null;
        }
        state.calls += 1;
        throw new Error(`localStorage must never be touched (prop: ${String(prop)})`);
      },
      set: () => {
        state.calls += 1;
        throw new Error('localStorage must never be touched');
      },
    },
  );
  Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
  return state;
}

function stubFetch(): { seen: RequestInit[] } {
  const seen: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    (async (_url: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: { ok: true }, requestId: 'test' }),
      } as unknown as Response;
    }) as typeof fetch,
  );
  return { seen };
}

describe('bearer fallback client wiring', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    removeSessionStorage();
    setSessionToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    removeSessionStorage();
    setSessionToken(null);
  });

  it('attaches Authorization: Bearer on GET and POST when a token is present', async () => {
    const backing = installSessionStorage();
    setSessionToken('sess-1.abc');
    expect(backing.get(SESSION_TOKEN_KEY)).toBe('sess-1.abc');
    const { seen } = stubFetch();
    await apiFetch('/api/v1/me');
    await apiFetch('/api/v1/slots/s/claims', { method: 'POST', body: '{}' });
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer sess-1.abc');
    }
  });

  it('sends no Authorization header when no token is stored', async () => {
    installSessionStorage();
    expect(getSessionToken()).toBeNull();
    const { seen } = stubFetch();
    await apiFetch('/api/v1/me');
    await apiFetch('/api/v1/slots/s/claims', { method: 'POST', body: '{}' });
    for (const init of seen) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['authorization']).toBeUndefined();
    }
  });

  it('stores the token in sessionStorage and never touches localStorage', async () => {
    const backing = installSessionStorage();
    const local = installThrowingLocalStorage();
    setSessionToken('sess-2.def');
    expect(backing.get(SESSION_TOKEN_KEY)).toBe('sess-2.def');
    expect(getSessionToken()).toBe('sess-2.def');
    const { seen } = stubFetch();
    await apiFetch('/api/v1/me');
    expect((seen[0]?.headers as Record<string, string>)['authorization']).toBe('Bearer sess-2.def');
    expect(local.calls).toBe(0);
  });

  it('logout clear removes the token from sessionStorage', () => {
    const backing = installSessionStorage();
    setSessionToken('sess-3.ghi');
    expect(backing.has(SESSION_TOKEN_KEY)).toBe(true);
    setSessionToken(null);
    expect(backing.has(SESSION_TOKEN_KEY)).toBe(false);
    expect(getSessionToken()).toBeNull();
  });

  it('falls back to in-memory storage when sessionStorage is unavailable', async () => {
    removeSessionStorage();
    expect(typeof (globalThis as Record<string, unknown>).sessionStorage).toBe('undefined');
    setSessionToken('sess-4.mem');
    // Readable without any store present.
    expect(getSessionToken()).toBe('sess-4.mem');
    const { seen } = stubFetch();
    await apiFetch('/api/v1/me');
    expect((seen[0]?.headers as Record<string, string>)['authorization']).toBe('Bearer sess-4.mem');
    setSessionToken(null);
    expect(getSessionToken()).toBeNull();
  });

  it('an explicit caller Authorization header still wins', async () => {
    installSessionStorage();
    setSessionToken('sess-5.stored');
    const { seen } = stubFetch();
    await apiFetch('/api/v1/me', { headers: { authorization: 'Bearer caller-choice' } });
    expect((seen[0]?.headers as Record<string, string>)['authorization']).toBe('Bearer caller-choice');
  });

  it('source posture: no localStorage reference anywhere in web src', () => {
    const offenders: string[] = [];
    const src = resolve(process.cwd(), 'src');
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const text = readFileSync(full, 'utf8');
          text.split('\n').forEach((line, idx) => {
            if (/localStorage/.test(line)) {
              offenders.push(`${full}:${idx + 1}`);
            }
          });
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
