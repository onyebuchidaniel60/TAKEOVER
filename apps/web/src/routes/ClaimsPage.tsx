// Phase 6: the caller's hold history, filterable by status.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ClaimCard from '../components/ClaimCard';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import { fetchMyClaims, type ClaimView } from '../lib/slots';

const FILTERS = ['', 'active_hold', 'expired', 'cancelled'] as const;
const LABELS: Record<string, string> = {
  '': 'All',
  active_hold: 'On hold',
  expired: 'Ended',
  cancelled: 'Cancelled',
};

export default function ClaimsPage() {
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchMyClaims({ status: status || undefined, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setClaims(res.claims);
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
  }, [status, retryKey]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">My holds</h1>
      <p className="mt-1 text-sm text-slate-500">
        {total} hold{total === 1 ? '' : 's'} in total.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setStatus(f)}
            aria-pressed={status === f}
            className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-medium ${
              status === f ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {LABELS[f] ?? f}
          </button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : claims.length === 0 ? (
          <EmptyState
            title="No holds yet"
            body="Find an opening you like and claim it — it will show up here."
            action={
              <Link
                to="/"
                className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Browse openings
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="My claims">
            {claims.map((claim) => (
              <li key={claim.id}>
                <ClaimCard claim={claim} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
