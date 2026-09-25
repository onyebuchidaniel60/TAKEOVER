// Hold one unit of a claimable opening, then open the claim page.
// No wallet SDK here — the session cookie authenticates the POST.
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

export default function ClaimButton({ slotId }: { slotId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Money mutation: on success the slot (availability changed), the
  // buyer's holds, and every feed list are stale — invalidate all
  // three, then navigate. Invalidations run fire-and-forget so the
  // navigation never waits on refetches.
  const claimMutation = useMutation({
    mutationFn: (id: string) => createClaim(id),
    onSuccess: ({ claim }) => {
      void queryClient.invalidateQueries({ queryKey: ['slot', slotId] });
      void queryClient.invalidateQueries({ queryKey: ['my-claims'] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      navigate(`/claim/${claim.id}`);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    },
  });
  const claiming = claimMutation.isPending;

  const handleClick = (): void => {
    setError(null);
    claimMutation.mutate(slotId);
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
              className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint/30 border-t-text-faint"
            />
            Claim this slot
          </span>
        ) : (
          'Claim this slot'
        )}
      </button>
      {error ? (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
