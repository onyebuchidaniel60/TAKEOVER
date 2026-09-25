// Holds grouped into collapsible status buckets (newest data from
// one unfiltered fetch). Reuses the shared claim components throughout.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ClaimCard from '../components/ClaimCard';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import { fetchMyClaims, groupClaimsForBuckets } from '../lib/slots';

export default function ClaimsPage() {
  usePageMeta({ title: 'My holds — TAKEOVER' });
  const claimsQuery = useQuery({
    queryKey: queryKeys.myClaims,
    queryFn: () => fetchMyClaims({ limit: 50 }),
  });
  const claims = claimsQuery.data?.claims ?? [];
  const buckets = groupClaimsForBuckets(claims);
  const total = claimsQuery.data?.total ?? 0;
  const loading = claimsQuery.isPending;
  const error = claimsQuery.error
    ? claimsQuery.error instanceof ApiError
      ? claimsQuery.error.message
      : 'Something went wrong.'
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-h1 font-bold text-text">My holds</h1>
      <p className="mt-1 font-mono text-body tabular-nums text-muted">
        {total} hold{total === 1 ? '' : 's'} in total.
      </p>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void claimsQuery.refetch()} />
        ) : total === 0 ? (
          <EmptyState
            title="You haven't claimed anything yet."
            body="Find an opening you like and claim it — it will show up here."
            action={
              <Link
                to="/"
                className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
              >
                Browse openings
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {buckets.map((bucket) => (
              <details
                key={bucket.key}
                open={bucket.claims.length > 0}
                className="rounded-xl border border-border bg-surface"
              >
                <summary className="min-h-touch cursor-pointer list-none px-4 py-3 text-body font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                  {bucket.title} ({bucket.claims.length})
                </summary>
                <div className="border-t border-border p-4">
                  {bucket.claims.length === 0 ? (
                    <p className="text-body text-muted">{bucket.emptyText}</p>
                  ) : (
                    <ul className="flex flex-col gap-3" aria-label={bucket.title}>
                      {bucket.claims.map((claim) => (
                        <li key={claim.id}>
                          <ClaimCard claim={claim} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
