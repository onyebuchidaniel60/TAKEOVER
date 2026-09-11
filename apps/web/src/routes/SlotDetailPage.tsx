// Phase 4: public slot detail. Handles loading, error, not-found, and
// sold-out states. No claim action yet (Phase 6).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import SlotDetail from '../components/SlotDetail';
import { ApiError } from '../lib/api';
import { fetchSlot, type PublicSlot } from '../lib/slots';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; slot: PublicSlot };

export default function SlotDetailPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    if (!slotId) {
      setState({ kind: 'not-found' });
      return;
    }
    void fetchSlot(slotId)
      .then(({ slot }) => {
        if (!cancelled) setState({ kind: 'ready', slot });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND')) {
          setState({ kind: 'not-found' });
          return;
        }
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Something went wrong.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slotId, retryKey]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/" className="inline-block min-h-[44px] py-2 text-sm font-medium text-slate-600">
        ← Back to openings
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <LoadingSkeleton rows={1} />
        ) : state.kind === 'error' ? (
          <ErrorState message={state.message} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : state.kind === 'not-found' ? (
          <EmptyState
            title="This opening is no longer available"
            body="It may have been claimed, cancelled, or already started. Browse what’s open now."
            action={
              <Link
                to="/"
                className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                See available openings
              </Link>
            }
          />
        ) : (
          <SlotDetail slot={state.slot} />
        )}
      </div>
    </main>
  );
}
