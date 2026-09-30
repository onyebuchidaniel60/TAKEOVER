// Follow button (Phase 5k-C).
//
// Two visual states, one control. Per owner decision D19 follow is
// COSMETIC — there is no feed effect and no notification, so the button
// promises nothing beyond the number changing.
//
// Two behaviours worth stating:
//   - OPTIMISTIC: the state flips on tap and rolls back on error, so the
//     control feels instant. The server response is authoritative on
//     success and a refetch reconciles afterwards.
//   - SELF-FOLLOW IS NOT RENDERED. The caller hides the button on your own
//     profile (the API would answer 409); the 409 is still handled here so
//     a race can never leave a dead button on screen.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUser, unfollowUser } from '../lib/slots';
import { queryKeys } from '../lib/queryKeys';
import { useAuth } from '../store/auth';

export default function FollowButton({
  username,
  initialFollowing,
}: {
  username: string;
  /** Server-known state for this viewer (from the profile query). */
  initialFollowing: boolean;
}) {
  const queryClient = useQueryClient();
  const status = useAuth((s) => s.status);
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);

  // Optimistic flip, revert on error. Both endpoints are idempotent, so a
  // double-tap cannot create a duplicate edge.
  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? followUser(username) : unfollowUser(username),
    onMutate: (next) => {
      setError(null);
      setFollowing(next);
    },
    onError: () => {
      setFollowing(!following);
      setError('Could not update follow. Try again.');
    },
    onSettled: () => {
      // Counts and the list reads all hang off the profile, so invalidate
      // them together — this is the single place a follow changes shape.
      void queryClient.invalidateQueries({ queryKey: queryKeys.user(username) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.followers(username) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.following(username) });
    },
  });

  if (status !== 'authenticated') {
    return (
      <a
        href={`/welcome?next=${encodeURIComponent(`/u/${username}`)}`}
        className="inline-flex min-h-touch items-center justify-center rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
      >
        Follow
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        disabled={mutation.isPending}
        aria-pressed={following}
        onClick={() => mutation.mutate(!following)}
        className={
          following
            ? 'inline-flex min-h-touch items-center justify-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none disabled:opacity-60'
            : 'inline-flex min-h-touch items-center justify-center rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none disabled:opacity-60'
        }
      >
        {following ? 'Following' : 'Follow'}
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-small text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
