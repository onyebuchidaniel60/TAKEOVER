// Provider's own openings in every status, plus entry to creation.
// Summary tiles plus per-card demand counts (single source: the
// same /me/slots endpoint for tiles; the provider claims endpoint for counts).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import StatusBadge from '../components/StatusBadge';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import { fetchMySlots, fetchSlotClaims } from '../lib/slots';

const FILTERS = ['', 'draft', 'published', 'cancelled'] as const;

export default function Sell() {
  usePageMeta({ title: 'My openings — TAKEOVER' });
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('');

  // List query (server-filtered) plus the tiles query (unfiltered). When
  // no filter is active both read the same cache entry — the old code
  // fired the identical request twice.
  const listQuery = useQuery({
    queryKey: queryKeys.mySlots(status),
    queryFn: () => fetchMySlots({ status: status || undefined, limit: 50 }),
  });
  const showAll = status === '';
  const tilesQuery = useQuery({
    queryKey: queryKeys.mySlots('all'),
    queryFn: () => fetchMySlots({ limit: 50 }),
    enabled: !showAll,
  });
  const list = listQuery.data;
  const all = showAll ? listQuery.data : tilesQuery.data;
  const slots = list?.slots ?? [];
  const total = list?.total ?? 0;
  // Tiles count live supply by lifecycle state (Active = published;
  // sold-out gets its own tile instead of double-counting).
  const tiles = {
    active: (all?.slots ?? []).filter((s) => s.status === 'published').length,
    drafts: (all?.slots ?? []).filter((s) => s.status === 'draft').length,
    soldOut: (all?.slots ?? []).filter((s) => s.status === 'sold_out').length,
  };
  const loading = listQuery.isPending || (!showAll && tilesQuery.isPending);
  const firstError = listQuery.error ?? (!showAll ? tilesQuery.error : null);
  const error = firstError
    ? firstError instanceof ApiError
      ? firstError.message
      : 'Something went wrong.'
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 font-bold text-text">My openings</h1>
          <p className="mt-1 font-mono text-body tabular-nums text-muted">
            {total} opening{total === 1 ? '' : 's'} in total.
          </p>
        </div>
        <Link
          to="/sell/new"
          className="min-h-touch shrink-0 rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-accent focus-visible:ring-offset-surface"
        >
          Create slot
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Listing summary">
        <Tile label="Active listings" value={tiles.active} />
        <Tile label="Drafts" value={tiles.drafts} />
        <Tile label="Sold out" value={tiles.soldOut} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setStatus(f)}
            aria-pressed={status === f}
            className={`min-h-touch rounded-full px-4 py-2 text-body font-medium ${
              status === f
                ? 'bg-accent text-accent-ink'
                : 'border border-border-strong bg-surface text-muted'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              void listQuery.refetch();
              if (!showAll) void tilesQuery.refetch();
            }}
          />
        ) : slots.length === 0 ? (
          <EmptyState
            title="No openings yet"
            body="Publish your first opening and it will show up here — and in the marketplace."
            action={
              <Link
                to="/sell/new"
                className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
              >
                Create your first slot
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="My slots">
            {slots.map((slot) => (
              <li key={slot.id}>
                <Link
                  to={`/sell/${slot.id}`}
                  className="block rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-h3 font-semibold text-text">{slot.title}</h2>
                    <StatusBadge status={slot.status} />
                  </div>
                  <p className="mt-1 font-mono text-small tabular-nums text-muted">
                    {new Date(slot.starts_at).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    · {slot.available_quantity} of {slot.total_quantity} left
                    <SlotClaimCount slotId={slot.id} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-center">
      <p className="font-mono text-h2 font-bold tabular-nums text-text">{value}</p>
      <p className="mt-1 text-small text-muted">{label}</p>
    </div>
  );
}

// Demand line per card, shown only when at least one hold exists. Counts come
// from the provider claims endpoint — the same source as the counts it shows.
function SlotClaimCount({ slotId }: { slotId: string }) {
  const countsQuery = useQuery({
    queryKey: queryKeys.slotClaims(slotId),
    queryFn: () => fetchSlotClaims(slotId),
  });
  const count = countsQuery.data ? countsQuery.data.claims.length : null;

  if (count === null || count === 0) {
    return null;
  }
  return (
    <span>
      {' '}· {count} hold{count === 1 ? '' : 's'}
    </span>
  );
}
