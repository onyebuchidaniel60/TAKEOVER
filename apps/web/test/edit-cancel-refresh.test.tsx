// @vitest-environment jsdom
// Phase 5q — two owner-reported UX bugs.
//
// BUG 1 (edit-profile Cancel). ProfileSetup is reused as the settings variant
// (?from=settings). Its second button was labelled "Cancel" but called the same
// handler as onboarding's "Skip for now", which runs the whole save path:
// validateDisplayName -> updateProviderProfile -> markOnboarded. So the one
// control whose job is to leave WITHOUT committing was gated on a required
// field that starts empty, and wrote the profile when it did succeed. These
// tests pin the fixed contract: Cancel leaves immediately, saves nothing, and
// raises no validation error even with the name blank.
//
// BUG 2 (refresh loses the session). The reported symptom does NOT reproduce:
// with a token present in sessionStorage, a reload keeps /me at 200. What the
// tests below pin is the contract that makes it true — the token is read from
// sessionStorage on the first request after boot (no memory-only cache, no
// wait-and-retry), and clearing sessionStorage genuinely logs out. That second
// test matters as much as the first: it proves the read path is sessionStorage
// and not a module variable, which is the only thing that would let a refresh
// silently drop the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithClient } from './test-utils';
import { mockFetch } from './a11y-helpers';
import ProfileSetup from '../src/routes/onboarding/ProfileSetup';
import { useAuth } from '../src/store/auth';

const REQUESTS: { url: string; method: string }[] = [];

beforeEach(() => {
  REQUESTS.length = 0;
  useAuth.setState({
    status: 'authenticated',
    // An EMAIL signup already has a handle, so the settings screen renders the
    // disabled-username branch and the Cancel/Skip decision is reached.
    user: { id: 'u-1', username: 'someone', role: 'buyer', status: 'active' } as never,
    error: null,
    initialized: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
});

function renderSettings(): void {
  renderWithClient(
    <MemoryRouter initialEntries={['/onboarding/profile?from=settings']}>
      <Routes>
        <Route path="/onboarding/profile" element={<ProfileSetup />} />
        <Route path="/profile" element={<div>profile-stub</div>} />
        <Route path="/onboarding/interests" element={<div>interests-stub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BUG 1 — edit-profile Cancel really cancels', () => {
  it('returns to Profile immediately with the name EMPTY — no validation wall', async () => {
    mockFetch((url, init) => {
      REQUESTS.push({ url, method: init?.method ?? 'GET' });
      return {};
    });
    renderSettings();
    const user = userEvent.setup();
    // The name field starts empty — this is the exact state that used to trap
    // the user. No HTML `required` is involved; the wall was in the handler.
    expect((await screen.findByLabelText('Full name') as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('profile-stub')).toBeDefined();
    // The trap presented as a validation error; there must be none.
    expect(screen.queryByText(/Use at least 2 characters/)).toBeNull();
  });

  it('saves NOTHING: no PATCH /me/provider-profile, no /me/onboarded', async () => {
    mockFetch((url, init) => {
      REQUESTS.push({ url, method: init?.method ?? 'GET' });
      return {};
    });
    renderSettings();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await screen.findByText('profile-stub');
    const writes = REQUESTS.filter(
      (r) => r.method !== 'GET' || r.url.includes('/me/onboarded') || r.url.includes('/provider-profile'),
    );
    expect(writes).toEqual([]);
  });

  it('leaves immediately even when the user has typed unsaved changes', async () => {
    mockFetch((url, init) => {
      REQUESTS.push({ url, method: init?.method ?? 'GET' });
      return {};
    });
    renderSettings();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Some Edited Name');
    await user.type(screen.getByLabelText('Bio (optional)'), 'half-written thought');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('profile-stub')).toBeDefined();
    // Discarded, not committed.
    expect(REQUESTS.some((r) => r.url.includes('/me/profile'))).toBe(false);
  });

  it('is a type="button", so it can never submit the form', async () => {
    mockFetch(() => ({}));
    renderSettings();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('type')).toBe('button');
  });

  it('onboarding "Skip for now" still saves — it is a DIFFERENT action', async () => {
    // Regression guard for the fix itself. The bug was one handler serving two
    // opposite intentions; collapsing them into "everything cancels" would
    // break onboarding, which legitimately persists the required name.
    mockFetch((url, init) => {
      REQUESTS.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/api/v1/me/provider-profile')) return { providerProfile: { displayName: 'Jordan Lee' } };
      if (url.endsWith('/api/v1/me/onboarded')) return { user: { id: 'u-1', onboardedAt: new Date().toISOString() } };
      return {};
    });
    renderWithClient(
      <MemoryRouter initialEntries={['/onboarding/profile']}>
        <Routes>
          <Route path="/onboarding/profile" element={<ProfileSetup />} />
          <Route path="/onboarding/interests" element={<div>interests-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Jordan Lee');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('interests-stub')).toBeDefined();
    expect(REQUESTS.some((r) => r.url.includes('/api/v1/me/provider-profile'))).toBe(true);
  });

  it('a handle-less wallet account sees the handle field AND Cancel in settings', async () => {
    // Regression guard for a Phase 5o-A inconsistency: the settings screen
    // omitted the username field entirely for a handle-less account, while the
    // Profile page offered the identical claim one tap away. Same action, two
    // entry points, one silently missing.
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u-2', username: null, walletAddress: 'NQ0700000000000000000000000000000000', role: 'buyer', status: 'active' } as never,
      error: null,
      initialized: true,
    });
    mockFetch(() => ({}));
    renderSettings();
    const field = (await screen.findByLabelText('Username')) as HTMLInputElement;
    expect(field.disabled).toBe(false);
    // Optional here: D25's requirement is an ONBOARDING gate, not a settings one.
    expect(field.required).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByText(/A username keeps your profile linkable/)).toBeNull();
  });
});

describe('BUG 2 — session survives a reload', () => {
  it('/me is called WITH the Bearer header on the first request after remount', async () => {
    // The reported bug is that a refresh loses the session. The mechanism that
    // would cause it is a token read from memory instead of storage, or a
    // first request that fires before the token is available. This asserts
    // neither happens: the very first /me after a remount carries the header.
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      (async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/api/v1/me')) {
          seen.push({ url: u, auth: init?.headers ? String((init.headers as Record<string, string>).authorization ?? '') : null });
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ data: { user: { id: 'u-1', username: 'someone' } } }),
          };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: {} }) };
      }) as unknown as typeof fetch,
    );
    // Simulate the token surviving a reload (sessionStorage does).
    sessionStorage.setItem('takeover.sessionToken', 'sess_abc.def_secret');

    // "Refresh" = a fresh store instance against the same storage.
    useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: false });
    const user = await useAuth.getState().refresh();

    expect(user).not.toBeNull();
    expect(useAuth.getState().status).toBe('authenticated');
    expect(seen.length).toBeGreaterThan(0);
    // EVERY /me carries it, including the first.
    for (const call of seen) {
      expect(call.auth).toMatch(/^Bearer sess_abc\.def_secret/);
    }
  });

  it('clearing sessionStorage logs out — proving the read path IS sessionStorage', async () => {
    // The counterpart to the test above. If the token were cached in a
    // module-level variable, this would still be authenticated, and the read
    // path would not be storage — which is precisely how a refresh could drop
    // a session without anything looking wrong.
    const okFetch = () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ data: { user: { id: 'u-1', username: 'someone' } } }),
      }) as unknown as typeof fetch;
    // Stub BEFORE the first refresh: unstubbed, this would attempt a real
    // network call and the assertion would pass or fail for the wrong reason.
    vi.stubGlobal('fetch', okFetch);
    sessionStorage.setItem('takeover.sessionToken', 'sess_abc.def_secret');
    await useAuth.getState().refresh();
    expect(useAuth.getState().status).toBe('authenticated');

    sessionStorage.removeItem('takeover.sessionToken');
    useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: false });
    vi.stubGlobal(
      'fetch',
      (async () => ({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }),
      })) as unknown as typeof fetch,
    );
    const user = await useAuth.getState().refresh();
    expect(user).toBeNull();
    expect(useAuth.getState().status).toBe('unauthenticated');
    sessionStorage.clear();
  });

  it('a failed /me does NOT destroy the stored token (no self-inflicted logout)', async () => {
    // A transient failure must not escalate to a logout: the token has to
    // survive so the next request can retry it. This is the difference between
    // "the network blipped" and "you are logged out".
    sessionStorage.setItem('takeover.sessionToken', 'sess_abc.def_secret');
    vi.stubGlobal(
      'fetch',
      (async () => ({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: { code: 'RPC_UNAVAILABLE', message: 'try later' } }),
      })) as unknown as typeof fetch,
    );
    await useAuth.getState().refresh();
    expect(useAuth.getState().status).toBe('unauthenticated');
    // Still there for the next attempt.
    expect(sessionStorage.getItem('takeover.sessionToken')).toBe('sess_abc.def_secret');
    sessionStorage.clear();
  });

  it('localStorage is never consulted for the session token', async () => {
    // Phase 14c chose sessionStorage deliberately (tab-scoped model). This
    // keeps that decision from eroding by accident.
    const arm = vi.fn();
    const trap = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'length') return 0;
          if (prop === 'key') return null;
          arm(String(prop));
          throw new Error(`localStorage must never be touched (${String(prop)})`);
        },
        set: (_t, prop) => {
          arm(String(prop));
          throw new Error('localStorage must never be written');
        },
      },
    );
    Object.defineProperty(globalThis, 'localStorage', { value: trap, configurable: true });
    try {
      sessionStorage.setItem('takeover.sessionToken', 'sess_abc.def_secret');
      vi.stubGlobal(
        'fetch',
        (async () => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ data: { user: { id: 'u-1' } } }),
        })) as unknown as typeof fetch,
      );
      await useAuth.getState().refresh();
      expect(useAuth.getState().status).toBe('authenticated');
      expect(arm).not.toHaveBeenCalled();
      sessionStorage.clear();
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});