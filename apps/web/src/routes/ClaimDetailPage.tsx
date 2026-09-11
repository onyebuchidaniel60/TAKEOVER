// Phase 6: one held opening. Live countdown while the hold is live;
// payment arrives in the next step — no payment UI here.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import HoldCountdown from '../components/HoldCountdown';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PriceDisplay from '../components/PriceDisplay';
import TimeBadge from '../components/TimeBadge';
import { ApiError } from '../lib/api';
import { fetchClaim, type ClaimView, type PublicSlot } from '../lib/slots';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; claim: ClaimView; slot: PublicSlot };

export default function ClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    if (!claimId) {
      setState({ kind: 'not-found' });
      return;
    }
    void fetchClaim(claimId)
      .then(({ claim, slot }) => {
        if (!cancelled) setState({ kind: 'ready', claim, slot });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === 'CLAIM_NOT_FOUND')) {
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
  }, [claimId, retryKey]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/claims" className="inline-block min-h-[44px] py-2 text-sm font-medium text-slate-600">
        ← Back to my holds
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <LoadingSkeleton rows={1} />
        ) : state.kind === 'error' ? (
          <ErrorState message={state.message} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : state.kind === 'not-found' ? (
          <EmptyState
            title="Hold not found"
            body="It may belong to a different account, or the link is wrong."
            action={
              <Link
                to="/claims"
                className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                See my holds
              </Link>
            }
          />
        ) : (
          <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ClaimStatusBadge status={state.claim.status} />
                {state.claim.status === 'active_hold' ? (
                  <HoldCountdown holdExpiresAt={state.claim.hold_expires_at} />
                ) : null}
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight">{state.slot.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TimeBadge startsAt={state.slot.starts_at} endsAt={state.slot.ends_at} />
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <PriceDisplay priceNim={state.slot.price_nim} large />
              </div>
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                Your spot is held while the timer runs. Payment coming in the next step — nothing
                to pay yet.
              </p>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
