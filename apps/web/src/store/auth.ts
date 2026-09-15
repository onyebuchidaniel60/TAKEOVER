import { create } from 'zustand';
import { ApiError, apiFetch, setSessionToken } from '../lib/api';
import { connectWallet, signChallenge } from '../lib/nimiq';

export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated';

export interface AuthUser {
  id: string;
  walletAddress: string;
  role: string;
  status: string;
  hasProviderProfile?: boolean;
  providerProfile?: { displayName: string } | null;
}

interface ChallengeResponse {
  challenge: string;
  nonce: string;
  expiresAt: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  initialized: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const useAuth = create<AuthState>()((set) => ({
  status: 'unauthenticated',
  user: null,
  error: null,
  initialized: false,

  login: async () => {
    set({ status: 'authenticating', error: null });
    try {
      const { provider, accounts } = await connectWallet();
      const walletAddress = accounts[0];
      const challenge = await apiFetch<ChallengeResponse>('/api/v1/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ walletAddress }),
      });
      const { publicKey, signature } = await signChallenge(provider, challenge.challenge);
      const verified = await apiFetch<{ user: AuthUser; sessionToken?: string }>('/api/v1/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ walletAddress, nonce: challenge.nonce, signature, publicKey }),
      });
      // Phase 14c Bearer fallback: keep the session token for cookie-blocking
      // hosts. Stored in sessionStorage only (see lib/api); ignored when the
      // backend predates the field.
      if (typeof verified.sessionToken === 'string' && verified.sessionToken.length > 0) {
        setSessionToken(verified.sessionToken);
      }
      set({ status: 'authenticated', user: verified.user, error: null, initialized: true });
    } catch (err) {
      set({ status: 'unauthenticated', user: null, error: messageOf(err), initialized: true });
    }
  },

  logout: async () => {
    try {
      // Phase 14c round 3 (Fix A1): send a JSON body — a bodyless POST under
      // content-type: application/json is rejected before it revokes anything.
      await apiFetch('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // Server already forgot us or unreachable: still reset local state.
    }
    // Phase 14c: dropping the Bearer token is part of logout — the server
    // revokes the single underlying session, killing both credential paths.
    setSessionToken(null);
    set({ status: 'unauthenticated', user: null, error: null, initialized: true });
  },

  refresh: async () => {
    try {
      const me = await apiFetch<{ user: AuthUser }>('/api/v1/me');
      set({ status: 'authenticated', user: me.user, error: null, initialized: true });
    } catch {
      set({ status: 'unauthenticated', user: null, error: null, initialized: true });
    }
  },
}));
