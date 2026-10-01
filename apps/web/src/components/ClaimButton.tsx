// Hold one or more units of a claimable opening, then open the claim page.
// No wallet SDK here — the session cookie authenticates the POST.
//
// Phase 5n-A (D22): claiming needs a wallet, and a wallet-less email user
// used to dead-end on a 409. Instead the 409 opens an inline wallet dialog
// and the claim RESUMES by itself once the wallet is linked. The user never
// has to find the profile, and never has to press Claim twice.
//
// Phase 5n-D: `quantity` is threaded through the whole flow INCLUDING the
// wallet-gate resume — a retry that silently dropped the quantity would
// claim one unit after the user asked for three, which is the worst possible
// place to lose it. Undefined = the pre-5n-D call, so a single-unit slot
// sends exactly the body it always did.
//
// Primary pill per design.md §7: accent fill, accent-ink text,
// press scale(0.97) at 120ms ease-out-strong. Disabled (in-flight
// only — claimability itself is gated by the page) is surface-2 +
// text-faint with no scale. The in-flight spinner sits inside the
// button beside the unchanged label so the button keeps its size.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { createClaim } from '../lib/slots';
import { useWalletLink } from '../hooks/useWalletLink';
import WalletConnectModal from './WalletConnectModal';

export default function ClaimButton({
  slotId,
  quantity,
}: {
  slotId: string;
  /** Phase 5n-D: units to claim. Undefined = 1 (pre-5n-D behaviour). */
  quantity?: number;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const { link, isLinking, error: linkError } = useWalletLink();
  // Phase 5n-D: the label states the amount, so the number the buyer chose
  // and the number they are about to commit to cannot disagree. At one unit
  // (or no selector at all) the copy is exactly what it has always been.
  const label = quantity && quantity > 1 ? `Claim ${quantity} slots` : 'Claim this slot';

  // Money mutation: on success the slot (availability changed), the
  // buyer's holds, and every feed list are stale — invalidate all
  // three, then navigate. Invalidations run fire-and-forget so the
  // navigation never waits on refetches.
  const claimMutation = useMutation({
    mutationFn: (id: string) => createClaim(id, quantity),
    onSuccess: ({ claim }) => {
      void queryClient.invalidateQueries({ queryKey: ['slot', slotId] });
      void queryClient.invalidateQueries({ queryKey: ['my-claims'] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      navigate(`/claim/${claim.id}`);
    },
    onError: (err: unknown) => {
      // WALLET_REQUIRED is not a failure to report — it is a step to
      // offer. Everything else keeps the existing error line.
      if (err instanceof ApiError && err.code === 'WALLET_REQUIRED') {
        setConnectOpen(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    },
  });
  const claiming = claimMutation.isPending;

  const handleClick = (): void => {
    setError(null);
    claimMutation.mutate(slotId);
  };

  const handleConnect = (): void => {
    void link().then((user) => {
      // Resume automatically: the user asked to claim, so once a wallet
      // exists we retry the claim they already consented to.
      if (user?.walletAddress) {
        setConnectOpen(false);
        claimMutation.mutate(slotId);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={claiming}
        className="min-h-[56px] w-full rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.97] disabled:scale-100 disabled:bg-surface-2 disabled:text-faint motion-reduce:transition-none"
      >
        {claiming ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-faint/30 border-t-faint"
            />
            {label}
          </span>
        ) : (
          label
        )}
      </button>
      {error ? (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {connectOpen ? (
        <div className="mt-3">
          <WalletConnectModal
            action={quantity && quantity > 1 ? `claim ${quantity} slots` : 'claim this slot'}
            onConnect={handleConnect}
            onDismiss={() => setConnectOpen(false)}
            isConnecting={isLinking}
            error={linkError}
          />
        </div>
      ) : null}
    </div>
  );
}
