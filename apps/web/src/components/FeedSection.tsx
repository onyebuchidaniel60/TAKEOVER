// Marketplace feed section: filters + fetch + list. Shared by Home
// (capped at a short page) and /openings (full list with show-more).
// Filters live in the URL query params so any filtered view is
// deep-linkable. Public and read-only.
//
// When capped, pagination stops at pageSize and a "See all openings"
// secondary CTA carries the current filters to /openings. When
// uncapped, the existing show-more button pages forward.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import LoadingSkeleton from './LoadingSkeleton';
import SearchFilters, { type FilterValues } from './SearchFilters';
import SlotList from './SlotList';
import { ApiError } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { fetchSlots } from '../lib/slots';

function isoToInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function FeedSection({ pageSize, capped }: { pageSize: number; capped: boolean }) {
  const location = useLocation();
  const notice =
    location.state && typeof location.state === 'object' && 'notice' in location.state
      ? String((location.state as { notice: unknown }).notice)
      : null;
  const [searchParams, setSearchParams] = useSearchParams();

  const paramKey = searchParams.toString();
  const values: FilterValues = {
    q: searchParams.get('q') ?? '',
    category: searchParams.get('category') ?? '',
    location: searchParams.get('location') ?? '',
    from: isoToInput(searchParams.get('from')),
    to: isoToInput(searchParams.get('to')),
  };

  // Paged feed keyed by the filter string: revisits inside the 30s stale
  // window render cached pages with zero fetches; filter edits key a
  // fresh (skeleton) load, exactly as before.
  const feedQuery = useInfiniteQuery({
    queryKey: queryKeys.slots(paramKey),
    queryFn: ({ pageParam }: { pageParam: number }) => {
      const params = new URLSearchParams(paramKey);
      return fetchSlots({
        q: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        location: params.get('location') ?? undefined,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
        limit: pageSize,
        offset: pageParam,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.slots.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const pages = feedQuery.data?.pages ?? [];
  const slots = pages.flatMap((p) => p.slots);
  const total = pages.length > 0 ? (pages[pages.length - 1]?.total ?? 0) : 0;
  // First load with no data → skeleton. Background refetch with data →
  // keep the list (stale-while-revalidate, never flash a skeleton).
  const loading = feedQuery.isPending;
  const loadingMore = feedQuery.isFetchingNextPage;
  const error = feedQuery.error
    ? feedQuery.error instanceof ApiError
      ? feedQuery.error.message
      : 'Something went wrong.'
    : null;

  const handleChange = useCallback(
    (next: FilterValues) => {
      const params = new URLSearchParams();
      if (next.q.trim()) params.set('q', next.q.trim());
      if (next.category.trim()) params.set('category', next.category.trim());
      if (next.location.trim()) params.set('location', next.location.trim());
      const from = inputToIso(next.from);
      const to = inputToIso(next.to);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setSearchParams(params);
    },
    [setSearchParams],
  );

  const handleClear = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const handleShowMore = useCallback(() => {
    void feedQuery.fetchNextPage();
  }, [feedQuery]);

  const hasMore = feedQuery.hasNextPage ?? false;
  const hasActiveFilters = paramKey.length > 0;

  return (
    <section id="openings" aria-labelledby="feed-heading" className="mt-8 scroll-mt-20">
      <h2 id="feed-heading" className="text-h2 font-bold text-text">
        Available now
      </h2>
      <p className="mt-1 text-body leading-relaxed text-muted">
        Last-minute openings near you. Claim one before it’s gone.
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-surface-2 p-3 text-body text-warning">
          {notice}
        </p>
      ) : null}
      <div className="mt-4">
        <SearchFilters values={values} onChange={handleChange} onClear={handleClear} />
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void feedQuery.refetch()} />
        ) : slots.length === 0 ? (
          <EmptyState
            action={
              hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="min-h-touch rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted transition-transform duration-press ease-out-strong active:scale-[0.97]"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-3 font-mono text-small tabular-nums text-muted">
              {total} opening{total === 1 ? '' : 's'} · soonest first
            </p>
            <SlotList slots={slots} />
            {hasMore && capped ? (
              <Link
                to={`/openings${paramKey ? `?${paramKey}` : ''}`}
                className="mt-4 inline-flex min-h-touch w-full items-center justify-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
              >
                See all openings
              </Link>
            ) : null}
            {hasMore && !capped ? (
              <button
                type="button"
                onClick={handleShowMore}
                disabled={loadingMore}
                className="mt-4 inline-flex min-h-touch w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-body font-medium text-text shadow-card transition-[box-shadow,transform] duration-ui ease-out-strong hover:shadow-card-hover active:scale-[0.99] disabled:opacity-50"
              >
                {loadingMore ? (
                  'Loading…'
                ) : (
                  <>
                    Show more ({total - slots.length} left)
                    <ChevronDown size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
