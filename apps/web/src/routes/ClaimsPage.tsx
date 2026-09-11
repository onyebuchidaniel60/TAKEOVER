// Phase 9: holds grouped into collapsible status buckets (newest data from
// one unfiltered fetch). Reuses the shared claim components throughout.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ClaimCard from '../components/ClaimCard';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { fetchMyClaims, groupClaimsForBuckets } from '../lib/slots';

export default function ClaimsPage() {
  usePageMeta({ title: 'My holds — TAKEOVER' });
  const [buckets, setBuckets] = useState<ReturnType<typeof groupClaimsForBuckets>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchMyClaims({ limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setBuckets(groupClaimsForBuckets(res.claims));
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">My holds</h1>
      <p className="mt-1 text-sm text-slate-500">
        {total} hold{total === 1 ? '' : 's'} in total.
      </p>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : total === 0 ? (
          <EmptyState
            title="You haven't claimed anything yet."
            body="Find an opening you like and claim it — it will show up here."
            action={
              <Link
                to="/"
                className="inline-block min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
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
                className="rounded-xl border border-slate-200 bg-white"
              >
                <summary className="min-h-touch cursor-pointer list-none px-4 py-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 [&::-webkit-details-marker]:hidden">
                  {bucket.title} ({bucket.claims.length})
                </summary>
                <div className="border-t border-slate-100 p-4">
                  {bucket.claims.length === 0 ? (
                    <p className="text-sm text-slate-500">{bucket.emptyText}</p>
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
