// Phase 6: one held opening. Live countdown while the hold is live.
// Phase 7: real payment panel for active holds; submitted/expired/paid states.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import HoldCountdown from '../components/HoldCountdown';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PaymentPanel from '../components/PaymentPanel';
import PriceDisplay from '../components/PriceDisplay';
import TimeBadge from '../components/TimeBadge';
import { ApiError } from '../lib/api';
import {
  createPaymentIntent,
  fetchClaim,
  type ClaimView,
  type PublicSlot,
} from '../lib/slots';

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

  const refresh = (): void => setRetryKey((k) => k + 1);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/claims" className="inline-block min-h-[44px] py-2 text-sm font-medium text-slate-600">
        ← Back to my holds
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <LoadingSkeleton rows={1} />
        ) : state.kind === 'error' ? (
          <ErrorState message={state.message} onRetry={refresh} />
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
          <ClaimBody claim={state.claim} slot={state.slot} onSubmitted={refresh} />
        )}
      </div>
    </main>
  );
}

function ClaimBody({
  claim,
  slot,
  onSubmitted,
}: {
  claim: ClaimView;
  slot: PublicSlot;
  onSubmitted: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ClaimStatusBadge status={claim.status} />
          {claim.status === 'active_hold' ? (
            <HoldCountdown holdExpiresAt={claim.hold_expires_at} />
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{slot.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <PriceDisplay priceNim={slot.price_nim} large />
        </div>
        {claim.status === 'active_hold' ? (
          <div className="mt-4">
            <PaymentPanel claim={claim} slot={slot} onSubmitted={onSubmitted} />
          </div>
        ) : null}
        {claim.status === 'payment_pending' ? <PendingBox claim={claim} /> : null}
        {claim.status === 'expired' ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Hold expired</p>
            <Link to={`/slot/${slot.id}`} className="mt-1 inline-block text-sm underline">
              Claim again
            </Link>
          </div>
        ) : null}
        {claim.status === 'paid' ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Payment verified.
          </p>
        ) : null}
        {claim.status !== 'active_hold' &&
        claim.status !== 'payment_pending' &&
        claim.status !== 'expired' &&
        claim.status !== 'paid' ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            This hold is no longer active.
          </p>
        ) : null}
      </div>
    </article>
  );
}

// Submitted state: shows the recorded hash. The intent endpoint is idempotent,
// so reading it here creates nothing new.
function PendingBox({ claim }: { claim: ClaimView }) {
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createPaymentIntent(claim.id)
      .then(({ intent }) => {
        if (!cancelled) setTxHash(intent.txHash);
      })
      .catch(() => {
        if (!cancelled) setTxHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [claim.id]);

  return (
    <div className="mt-4 rounded-lg bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">Payment submitted. Awaiting confirmation.</p>
      {txHash ? <p className="mt-1 break-all text-xs text-amber-800">{txHash}</p> : null}
      <p className="mt-1 text-xs text-amber-800">
        Hold deadline was {new Date(claim.hold_expires_at).toLocaleString()}. Confirmation is
        coming in a later phase — nothing more to do right now.
      </p>
    </div>
  );
}
