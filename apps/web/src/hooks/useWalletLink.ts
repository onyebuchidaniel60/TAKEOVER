// Wallet linking (Phase 5n-A, D22).
//
// The SAME three steps as wallet login — connect, challenge, sign — with one
// difference: the result is POSTed to /me/link-wallet (attach to the current
// account) instead of /auth/verify (become a wallet account). Reusing the
// login primitives is deliberate: two hand-rolled signing flows would drift.
//
// Deliberately does NOT touch the auth store's identity: the user is already
// signed in, and this adds a wallet without swapping who they are. On
// success the caller invalidates ['me'] so every consumer (Profile, the
// chrome chip) sees the new address.
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectWallet, signChallenge } from '../lib/nimiq';
import { apiFetch, ApiError } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import type { MeUser } from '../lib/slots';

interface ChallengeResponse {
  challenge: string;
  nonce: string;
}

/**
 * Two 409s are the difference between "this will never work" and "try
 * something else", so they get their own message rather than the raw code.
 * The second is not offered as a fix here: unlinking is a separate,
 * deliberate operation (see residual in DECISIONS.md).
 */
export function walletLinkMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'WALLET_TAKEN') {
      return 'This wallet is already linked to another account.';
    }
    if (err.code === 'WALLET_ALREADY_LINKED') {
      return 'Your account already has a wallet. Remove it before linking a new one.';
    }
  }
  return err instanceof Error ? err.message : 'Could not connect your wallet.';
}

export function useWalletLink() {
  const queryClient = useQueryClient();
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = useCallback(async (): Promise<MeUser | null> => {
    setIsLinking(true);
    setError(null);
    try {
      const { provider, accounts } = await connectWallet();
      const walletAddress = accounts[0];
      const challenge = await apiFetch<ChallengeResponse>('/api/v1/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ walletAddress }),
      });
      const { publicKey, signature } = await signChallenge(provider, challenge.challenge);
      const linked = await apiFetch<{ user: MeUser }>('/api/v1/me/link-wallet', {
        method: 'POST',
        body: JSON.stringify({ walletAddress, nonce: challenge.nonce, signature, publicKey }),
      });
      // ['me'] first (the address itself), then every slot-scoped cache: the
      // provider avatar + handle on cards come from slot projections.
      queryClient.setQueryData(queryKeys.me, { user: linked.user });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: ['slot'] });
      void queryClient.invalidateQueries({ queryKey: ['my-slots'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-slot'] });
      return linked.user;
    } catch (err) {
      setError(walletLinkMessage(err));
      return null;
    } finally {
      setIsLinking(false);
    }
  }, [queryClient]);

  return { link, isLinking, error, clearError: () => setError(null) };
}
