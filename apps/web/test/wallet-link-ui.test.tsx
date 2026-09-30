// @vitest-environment jsdom
// Phase 5n-A: the wallet-linking hook and its two surfaces.
//
// The hook is tested directly with renderHook: it is the unit that owns the
// connect -> challenge -> sign -> link sequence, and isolating it keeps the
// test out of Profile's re-render churn (a captured node goes stale there
// and the click silently no-ops). Profile's row is then tested for what it
// actually owns — tappability in each state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createTestQueryClient } from './test-utils';
import Profile from '../src/routes/Profile';
import ClaimButton from '../src/components/ClaimButton';
import { useWalletLink } from '../src/hooks/useWalletLink';
import { useAuth } from '../src/store/auth';

// vi.hoisted gives the mocked wallet functions a STABLE identity shared by
// the component under test and the assertions. A bare automock returns
// undefined from every export, so connectWallet() resolves to undefined and
// the flow dies before its first request.
const walletMocks = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  signChallenge: vi.fn(),
}));

vi.mock('../src/lib/nimiq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/nimiq')>();
  return { ...actual, connectWallet: walletMocks.connectWallet, signChallenge: walletMocks.signChallenge };
});

const WALLET = 'NQ93 TESTWALLETLINK0000000000000000';
const SIGNED_WALLET = 'NQ11 ALREADYLINKED000000000000000000000';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** One stub covering /me, the profile, and the link sequence. */
function stubApi(seen: string[], walletAfterLink: string | null = WALLET) {
  vi.stubGlobal(
    'fetch',
    (async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.includes('/me/link-wallet')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({ data: { user: { id: 'u1', username: 'me', walletAddress: walletAfterLink } } }),
        };
      }
      if (path.includes('/auth/challenge')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ data: { challenge: 'msg', nonce: 'abc' } }),
        };
      }
      if (path.includes('/api/v1/users/')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              data: {
                profile: {
                  username: 'me',
                  displayName: 'Me',
                  avatarData: null,
                  bio: null,
                  location: null,
                  memberSince: '2026-01-01',
                  isFollowing: null,
                  stats: { openings: 0, claims: 0, followers: 0, following: 0 },
                },
              },
            }),
        };
      }
      if (path.includes('/me/slots')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { slots: [], total: 0, limit: 3, offset: 0 } }) };
      }
      if (path.includes('/claims')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { claims: [], total: 0, limit: 1, offset: 0 } }) };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            data: {
              user: {
                id: 'u1',
                email: 'me@test.local',
                username: 'me',
                walletAddress: null,
                role: 'buyer',
                status: 'active',
                providerProfile: null,
              },
            },
          }),
      };
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'me' } as never,
    error: null,
    initialized: true,
  });
  walletMocks.connectWallet.mockResolvedValue({ provider: {} as never, accounts: [WALLET] } as never);
  walletMocks.signChallenge.mockResolvedValue({ publicKey: 'pk', signature: 'sig' } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useWalletLink (Phase 5n-A)', () => {
  it('runs connect -> challenge -> sign -> link and returns the updated user', async () => {
    const seen: string[] = [];
    stubApi(seen);
    const { result } = renderHook(() => useWalletLink(), { wrapper: Wrapper });

    let user: unknown = null;
    await act(async () => {
      user = await result.current.link();
    });

    expect(walletMocks.connectWallet).toHaveBeenCalledTimes(1);
    expect(walletMocks.signChallenge).toHaveBeenCalledTimes(1);
    expect(seen.some((p) => p.includes('/auth/challenge'))).toBe(true);
    expect(seen.some((p) => p.includes('/me/link-wallet'))).toBe(true);
    expect((user as { walletAddress: string } | null)?.walletAddress).toBe(WALLET);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a distinct message when the wallet belongs to another account', async () => {
    vi.stubGlobal(
      'fetch',
      (async (url: string) => {
        const path = String(url);
        if (path.includes('/auth/challenge')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { challenge: 'msg', nonce: 'abc' } }) };
        }
        return {
          ok: false,
          status: 409,
          headers: { get: () => null },
          json: () => Promise.resolve({ error: { code: 'WALLET_TAKEN', message: 'raw server text' } }),
        };
      }) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useWalletLink(), { wrapper: Wrapper });
    let user: unknown = 'unset';
    await act(async () => {
      user = await result.current.link();
    });
    expect(user).toBeNull();
    // Consumer language, not the server's raw string.
    expect(result.current.error).toBe('This wallet is already linked to another account.');
  });

  it('explains a second-wallet refusal', async () => {
    vi.stubGlobal(
      'fetch',
      (async (url: string) => {
        const path = String(url);
        if (path.includes('/auth/challenge')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { challenge: 'msg', nonce: 'abc' } }) };
        }
        return {
          ok: false,
          status: 409,
          headers: { get: () => null },
          json: () => Promise.resolve({ error: { code: 'WALLET_ALREADY_LINKED', message: 'raw' } }),
        };
      }) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useWalletLink(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.link();
    });
    expect(result.current.error).toMatch(/already has a wallet/i);
  });
});

describe('Profile — wallet row (Phase 5n-A)', () => {
  it('is a tappable control offering to connect while unlinked', async () => {
    stubApi([]);
    render(<Profile />, { wrapper: Wrapper });
    const row = await screen.findByRole('button', { name: /wallet/i });
    expect(row.textContent).toContain('Not set');
    // A chevron is what makes the row read as interactive rather than as a label.
    expect(row.querySelector('svg')).toBeTruthy();
  });

  it('is NOT a control once a wallet is linked', async () => {
    stubApi([], SIGNED_WALLET);
    // /me must report a linked wallet for this state.
    vi.stubGlobal(
      'fetch',
      (async (url: string) => {
        const path = String(url);
        if (path.includes('/api/v1/users/')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { profile: { username: 'me', displayName: 'Me', avatarData: null, bio: null, location: null, memberSince: '2026-01-01', isFollowing: null, stats: { openings: 0, claims: 0, followers: 0, following: 0 } } } }) };
        }
        if (path.includes('/me/slots')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { slots: [], total: 0, limit: 3, offset: 0 } }) };
        }
        if (path.includes('/claims')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { claims: [], total: 0, limit: 1, offset: 0 } }) };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { user: { id: 'u1', email: 'me@test.local', username: 'me', walletAddress: SIGNED_WALLET, role: 'buyer', status: 'active', providerProfile: null } } }) };
      }) as unknown as typeof fetch,
    );
    render(<Profile />, { wrapper: Wrapper });
    await screen.findByText('Information');
    // A linked wallet is a read-only row: no button that could only fail.
    await waitFor(() => expect(screen.getByText(/ALREADYLINKED/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /wallet/i })).toBeNull();
  });
});

describe('ClaimButton — inline wallet connection (D22)', () => {
  it('opens the connect dialog on WALLET_REQUIRED instead of showing an error', async () => {
    vi.stubGlobal(
      'fetch',
      (async () => ({
        ok: false,
        status: 409,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: { code: 'WALLET_REQUIRED', message: 'Connect a wallet to claim an opening.' } }),
      })) as unknown as typeof fetch,
    );
    render(<ClaimButton slotId="s1" />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole('button', { name: /claim this slot/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText(/connect your wallet to continue/i)).toBeTruthy();
    // The dead-end error line must NOT also be on screen.
    expect(screen.queryByText(/connect a wallet to claim an opening/i)).toBeNull();
  });

  it('resumes the claim automatically once the wallet links, with no second tap', async () => {
    let claims = 0;
    vi.stubGlobal(
      'fetch',
      (async (url: string, init?: RequestInit) => {
        const path = String(url);
        // Claim endpoint is POST /api/v1/slots/:id/claims.
        if (path.includes('/claims') && init?.method === 'POST') {
          claims += 1;
          if (claims === 1) {
            return { ok: false, status: 409, headers: { get: () => null }, json: () => Promise.resolve({ error: { code: 'WALLET_REQUIRED', message: 'nope' } }) };
          }
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { claim: { id: 'c1' } } }) };
        }
        if (path.includes('/me/link-wallet')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { user: { id: 'u1', username: 'me', walletAddress: WALLET } } }) };
        }
        if (path.includes('/auth/challenge')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: { challenge: 'msg', nonce: 'abc' } }) };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ data: {} }) };
      }) as unknown as typeof fetch,
    );
    render(<ClaimButton slotId="s1" />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole('button', { name: /claim this slot/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    // Dialog closes AND the claim fires again by itself.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(claims).toBe(2));
  });
});
