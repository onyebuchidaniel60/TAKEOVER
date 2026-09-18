// Phase 4: marketplace feed. Filters live in the URL query params so any
// filtered view is deep-linkable. Public and read-only.
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import Contact from '../components/home/Contact';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Faq from '../components/home/Faq';
import HowItWorks from '../components/home/HowItWorks';
import LoadingSkeleton from '../components/LoadingSkeleton';
import SearchFilters, { type FilterValues } from '../components/SearchFilters';
import SlotList from '../components/SlotList';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { fetchSlots, type PublicSlot } from '../lib/slots';

const PAGE_SIZE = 20;

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

export default function Home() {
  usePageMeta({
    title: 'TAKEOVER — last-minute availability, claimed',
    description:
      'TAKEOVER is the last-minute marketplace for released capacity. Claim an opening before it’s gone.',
  });
  const location = useLocation();
  const notice =
    location.state && typeof location.state === 'object' && 'notice' in location.state
      ? String((location.state as { notice: unknown }).notice)
      : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const paramKey = searchParams.toString();
  const values: FilterValues = {
    q: searchParams.get('q') ?? '',
    category: searchParams.get('category') ?? '',
    location: searchParams.get('location') ?? '',
    from: isoToInput(searchParams.get('from')),
    to: isoToInput(searchParams.get('to')),
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(paramKey);
    void fetchSlots({
      q: params.get('q') ?? undefined,
      category: params.get('category') ?? undefined,
      location: params.get('location') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setTotal(res.total);
        setOffset(0);
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
  }, [paramKey, retryKey]);

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
    const params = new URLSearchParams(paramKey);
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    void fetchSlots({
      q: params.get('q') ?? undefined,
      category: params.get('category') ?? undefined,
      location: params.get('location') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      limit: PAGE_SIZE,
      offset: nextOffset,
    })
      .then((res) => {
        setSlots((prev) => [...prev, ...res.slots]);
        setTotal(res.total);
        setOffset(nextOffset);
        setLoadingMore(false);
      })
      .catch(() => {
        setLoadingMore(false);
      });
  }, [offset, paramKey]);

  const hasMore = slots.length < total;
  const hasActiveFilters = paramKey.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-h1 font-bold text-slate-900 dark:text-stone-100">Available now</h1>
      <p className="mt-1 text-body leading-relaxed text-slate-500 dark:text-stone-400">
        Last-minute openings near you. Claim one before it’s gone.
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-body text-amber-900 dark:bg-amber-950 dark:text-amber-300">
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
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : slots.length === 0 ? (
          <EmptyState
            action={
              hasActiveFilters ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="min-h-touch rounded-lg border border-slate-300 bg-white px-4 py-2 text-body font-medium text-slate-700 transition-transform duration-press ease-out-strong active:scale-[0.97] dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-3 font-mono text-small tabular-nums text-slate-500 dark:text-stone-400">
              {total} opening{total === 1 ? '' : 's'} · soonest first
            </p>
            <SlotList slots={slots} />
            {hasMore ? (
              <button
                type="button"
                onClick={handleShowMore}
                disabled={loadingMore}
                className="mt-4 inline-flex min-h-touch w-full items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-body font-medium text-slate-800 shadow-card transition-[box-shadow,transform] duration-ui ease-out-strong hover:shadow-card-hover active:scale-[0.99] disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:shadow-none dark:hover:shadow-none"
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
      <div className="mt-12 flex flex-col gap-10">
        <HowItWorks />
        <Faq />
        <Contact />
      </div>
    </main>
  );
}
