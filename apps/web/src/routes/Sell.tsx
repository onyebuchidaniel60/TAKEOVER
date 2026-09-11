// Phase 5: provider's own openings in every status, plus entry to creation.
// Phase 9: summary tiles plus per-card demand counts (single source: the
// same /me/slots endpoint for tiles; the provider claims endpoint for counts).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import StatusBadge from '../components/StatusBadge';
import { ApiError } from '../lib/api';
import { fetchMySlots, fetchSlotClaims, type OwnerSlot } from '../lib/slots';

const FILTERS = ['', 'draft', 'published', 'cancelled'] as const;

export default function Sell() {
  const [slots, setSlots] = useState<OwnerSlot[]>([]);
  const [total, setTotal] = useState(0);
  const [tiles, setTiles] = useState({ active: 0, drafts: 0, soldOut: 0 });
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchMySlots({ status: status || undefined, limit: 50 }),
      fetchMySlots({ limit: 50 }),
    ])
      .then(([filtered, all]) => {
        if (cancelled) return;
        setSlots(filtered.slots);
        setTotal(filtered.total);
        // Tiles count live supply by lifecycle state (Active = published;
        // sold-out gets its own tile instead of double-counting).
        setTiles({
          active: all.slots.filter((s) => s.status === 'published').length,
          drafts: all.slots.filter((s) => s.status === 'draft').length,
          soldOut: all.slots.filter((s) => s.status === 'sold_out').length,
        });
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My openings</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} opening{total === 1 ? '' : 's'} in total.
          </p>
        </div>
        <Link
          to="/sell/new"
          className="min-h-[44px] shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          Create slot
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Listing summary">
        <Tile label="Active listings" value={tiles.active} />
        <Tile label="Drafts" value={tiles.drafts} />
        <Tile label="Sold out" value={tiles.soldOut} />
      </div>
      <div className="mt-4 flex gap-2" role="group" aria-label="Filter by status">
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
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : slots.length === 0 ? (
          <EmptyState
            title="No openings yet"
            body="Publish your first opening and it will show up here — and in the marketplace."
            action={
              <Link
                to="/sell/new"
                className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
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
                  className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold leading-snug">{slot.title}</h3>
                    <StatusBadge status={slot.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
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
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <p className="text-xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

// Demand line per card, shown only when at least one hold exists. Counts come
// from the provider claims endpoint — the same source as the counts it shows.
function SlotClaimCount({ slotId }: { slotId: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSlotClaims(slotId)
      .then(({ claims }) => {
        if (!cancelled) setCount(claims.length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slotId]);

  if (count === null || count === 0) {
    return null;
  }
  return (
    <span>
      {' '}· {count} hold{count === 1 ? '' : 's'}
    </span>
  );
}
