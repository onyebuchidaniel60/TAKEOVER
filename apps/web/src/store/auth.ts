import { create } from 'zustand';
import { ApiError, apiFetch, setSessionToken } from '../lib/api';
import {
  keepSessionToken,
  loginEmail as loginEmailRequest,
  registerEmail as registerEmailRequest,
} from '../lib/identity';
import { connectWallet, signChallenge } from '../lib/nimiq';

export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated';

export interface AuthUser {
  id: string;
  walletAddress: string | null;
  role: string;
  status: string;
  hasProviderProfile?: boolean;
  providerProfile?: { displayName: string } | null;
  avatarData?: string | null;
  email?: string | null;
  username?: string | null;
  /** Onboarding completion ISO timestamp. NULL/absent = must go through onboarding. */
  onboardedAt?: string | null;
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
  /** Email registration (Phase 5j onboarding). Throws ApiError for inline field errors. */
  registerWithEmail: (body: { email: string; password: string; username: string }) => Promise<void>;
  /** Email login (Phase 5j). Throws ApiError for inline errors. */
  loginWithEmail: (body: { email: string; password: string }) => Promise<void>;
  /** Mark onboarding complete (POST /me/onboarded) and refresh the cached user. */
  markOnboarded: () => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the session; resolves the user (or null) for cache seeding. */
  refresh: () => Promise<AuthUser | null>;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export const useAuth = create<AuthState>()((set, get) => ({
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
      // Bearer fallback: keep the session token for cookie-blocking
      // hosts. Stored in sessionStorage only (see lib/api); ignored when the
      // backend predates the field.
      if (typeof verified.sessionToken === 'string' && verified.sessionToken.length > 0) {
        setSessionToken(verified.sessionToken);
      }
      // Canonical user comes from /me (carries onboardedAt + identity
      // fields the verify response lacks); fall back to the verify user
      // only when the refresh itself fails.
      const me = await get().refresh();
      if (!me) {
        set({ status: 'authenticated', user: verified.user, error: null, initialized: true });
      }
    } catch (err) {
      set({ status: 'unauthenticated', user: null, error: messageOf(err), initialized: true });
    }
  },

  registerWithEmail: async (body) => {
    const response = await registerEmailRequest(body);
    keepSessionToken(response);
    const me = await get().refresh();
    if (!me) {
      set({
        status: 'authenticated',
        user: { ...response.user, onboardedAt: null },
        error: null,
        initialized: true,
      });
    }
  },

  loginWithEmail: async (body) => {
    const response = await loginEmailRequest(body);
    keepSessionToken(response);
    const me = await get().refresh();
    if (!me) {
      set({ status: 'authenticated', user: response.user, error: null, initialized: true });
    }
  },

  markOnboarded: async () => {
    const me = await apiFetch<{ user: AuthUser }>('/api/v1/me/onboarded', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    set({ user: me.user, status: 'authenticated', error: null, initialized: true });
  },

  logout: async () => {
    try {
      // Send a JSON body — a bodyless POST under
      // content-type: application/json is rejected before it revokes anything.
      await apiFetch('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // Server already forgot us or unreachable: still reset local state.
    }
    // Dropping the Bearer token is part of logout — the server
    // revokes the single underlying session, killing both credential paths.
    setSessionToken(null);
    set({ status: 'unauthenticated', user: null, error: null, initialized: true });
  },

  refresh: async () => {
    try {
      const me = await apiFetch<{ user: AuthUser }>('/api/v1/me');
      set({ status: 'authenticated', user: me.user, error: null, initialized: true });
      return me.user;
    } catch {
      set({ status: 'unauthenticated', user: null, error: null, initialized: true });
      return null;
    }
  },
}));
