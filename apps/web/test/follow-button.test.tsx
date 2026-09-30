// @vitest-environment jsdom
// Phase 5k-C: the Follow button.
//
// The behaviour worth pinning is the OPTIMISTIC one: the label flips on tap
// without waiting for the network, and rolls back when the request fails. A
// control that only updates after a round trip feels broken on a phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './test-utils';
import FollowButton from '../src/components/FollowButton';
import { useAuth } from '../src/store/auth';

/** Mount the button with the providers it needs. Returns unmount(). */
function mount(username: string, following: boolean): { unmount: () => void } {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <FollowButton username={username} initialFollowing={following} />
    </QueryClientProvider>,
  );
}

function stubFetch(handlers: (url: string, init?: RequestInit) => 'ok' | 'fail') {
  vi.stubGlobal(
    'fetch',
    (async (url: string, init?: RequestInit) => {
      const ok = handlers(String(url), init) === 'ok';
      return {
        ok,
        status: ok ? 200 : 500,
        headers: { get: () => null },
        json: () =>
          Promise.resolve(
            ok
              ? { data: { following: true }, requestId: 't' }
              : { error: { code: 'INTERNAL_ERROR', message: 'nope' }, requestId: 't' },
          ),
      };
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'me', username: 'me' } as never,
    error: null,
    initialized: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FollowButton (Phase 5k-C)', () => {
  it('shows Follow when not following and Following when following', () => {
    stubFetch(() => 'ok');
    const { unmount } = mount('target', false);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy();
    unmount();
    mount('target', true);
    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy();
  });

  it('flips the label immediately on tap, before the request resolves', async () => {
    // A deferred so the request is provably still in flight when we assert.
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      (async () => {
        await held;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ data: { following: true } }),
        };
      }) as unknown as typeof fetch,
    );
    mount('target', false);
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }));
    // Still "Following" while the request is deliberately unresolved.
    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy();
    gate.release();
  });

  it('rolls the label back and announces the failure when the request fails', async () => {
    stubFetch(() => 'fail');
    mount('target', false);
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('sends DELETE when un-following and POST when following', async () => {
    const seen: { url: string; method: string }[] = [];
    stubFetch((url, init) => {
      seen.push({ url, method: init?.method ?? 'GET' });
      return 'ok';
    });
    const { unmount } = mount('target', true);
    await userEvent.click(screen.getByRole('button', { name: 'Following' }));
    expect(seen.at(-1)?.method).toBe('DELETE');
    unmount();
    mount('target', false);
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(seen.at(-1)?.method).toBe('POST');
    expect(seen.at(-1)?.url).toContain('/users/target/follow');
  });

  it('exposes the pressed state for assistive tech', () => {
    stubFetch(() => 'ok');
    mount('target', true);
    expect(screen.getByRole('button', { name: 'Following' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers Sign in instead of a dead button to a guest', () => {
    useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
    stubFetch(() => 'ok');
    mount('target', false);
    // No button that could only fail; a link into the sign-in path instead.
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Follow' }).getAttribute('href')).toContain('/welcome');
  });
});
