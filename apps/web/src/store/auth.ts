import { create } from 'zustand';
import { ApiError, apiFetch } from '../lib/api';
import { connectWallet, signChallenge } from '../lib/nimiq';

export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated';

export interface AuthUser {
  id: string;
  walletAddress: string;
  role: string;
  status: string;
  hasProviderProfile?: boolean;
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
      const verified = await apiFetch<{ user: AuthUser }>('/api/v1/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ walletAddress, nonce: challenge.nonce, signature, publicKey }),
      });
      set({ status: 'authenticated', user: verified.user, error: null, initialized: true });
    } catch (err) {
      set({ status: 'unauthenticated', user: null, error: messageOf(err), initialized: true });
    }
  },

  logout: async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Server already forgot us or unreachable: still reset local state.
    }
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
