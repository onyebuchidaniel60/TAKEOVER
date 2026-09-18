// Phase 4: public slot detail. Handles loading, error, not-found, and
// sold-out states. Phase 6: authenticated buyers can claim a live opening.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClaimButton from '../components/ClaimButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ReportDialog from '../components/ReportDialog';
import SlotDetail from '../components/SlotDetail';
import { isAdminUser } from '../lib/admin';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { fetchSlot, formatUsdt, type PublicSlot } from '../lib/slots';
import { useAuth } from '../store/auth';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; slot: PublicSlot };

// Mirrors the server's claim gate: live status, future start, stock left.
function isClaimable(slot: PublicSlot): boolean {
  return (
    (slot.status === 'published' || slot.status === 'sold_out') &&
    new Date(slot.starts_at).getTime() > Date.now() &&
    slot.available_quantity > 0
  );
}

export default function SlotDetailPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const authenticated = useAuth((s) => s.status === 'authenticated');
  const user = useAuth((s) => s.user);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  // Shared-link preview: title, price, and time once the opening loads.
  const readySlot = state.kind === 'ready' ? state.slot : null;
  usePageMeta(
    readySlot
      ? {
          title: `${readySlot.title} — TAKEOVER`,
          description: `${formatUsdt(readySlot.price_usdt)} · ${new Date(readySlot.starts_at).toLocaleString()}. Claim it before it’s gone.`,
          og: {
            title: `${readySlot.title} — TAKEOVER`,
            description: `${formatUsdt(readySlot.price_usdt)} · ${new Date(readySlot.starts_at).toLocaleString()}`,
          },
        }
      : { title: 'Slot — TAKEOVER' },
  );

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
      <Link to="/" className="inline-block min-h-touch py-2 text-body font-medium text-taupe dark:text-drift">
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
                className="inline-block min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory dark:bg-sandlight dark:text-coal"
              >
                See available openings
              </Link>
            }
          />
        ) : (
          <>
            <SlotDetail slot={state.slot} />
            <div className="mt-4">
              {authenticated && isClaimable(state.slot) ? (
                <ClaimButton slotId={state.slot.id} />
              ) : null}
              {!authenticated ? (
                <p className="rounded-lg border border-hairline bg-cream p-3 text-body text-taupe dark:border-rootline dark:bg-cocoa dark:text-drift">
                  Connect your wallet to claim this opening.
                </p>
              ) : null}
            </div>
            {/* Public view: the owner projection is never served here, so every
                authenticated non-admin viewer may report. */}
            {authenticated && !isAdminUser(user) ? (
              <div className="mt-2">
                {reported ? (
                  <p role="status" className="text-body text-taupe dark:text-drift">
                    Thanks — an admin will review this opening.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReporting(true)}
                    className="min-h-touch text-body font-medium text-muted underline dark:text-drift"
                  >
                    Report this opening
                  </button>
                )}
              </div>
            ) : null}
            {reporting ? (
              <ReportDialog
                slotId={state.slot.id}
                onClose={() => setReporting(false)}
                onReported={() => setReported(true)}
              />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
