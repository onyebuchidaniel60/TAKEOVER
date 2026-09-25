// One held opening. Live countdown while the hold is live.
// Real payment panel for active holds; submitted/expired/paid states.
// Payment_pending polls verify-payment until the chain confirms.
// USDT escrow buyer loop replaces the deprecated direct-payment
// panel for escrow-active states; legacy payment_pending/review branches stay
// until zero legacy rows remain (§5 deprecation gates).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CategoryIcon from '../components/CategoryIcon';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import EscrowPanel from '../components/EscrowPanel';
import HoldCountdown from '../components/HoldCountdown';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PriceDisplay from '../components/PriceDisplay';
import TimeBadge from '../components/TimeBadge';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import {
  createPaymentIntent,
  fetchClaim,
  nextVerifyPollDelayMs,
  VERIFY_POLL_MAX_ATTEMPTS,
  verifyPayment,
  type ClaimView,
  type PublicSlot,
} from '../lib/slots';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; claim: ClaimView; slot: PublicSlot };

export default function ClaimDetailPage() {
  usePageMeta({ title: 'Claim — TAKEOVER' });
  const { claimId } = useParams<{ claimId: string }>();
  const queryClient = useQueryClient();

  const claimQuery = useQuery({
    queryKey: queryKeys.claim(claimId ?? ''),
    queryFn: () => fetchClaim(claimId ?? '').then((r) => ({ claim: r.claim, slot: r.slot })),
    enabled: !!claimId,
  });
  const pair = claimQuery.data ?? null;
  const queryError = claimQuery.error;
  const state: State =
    !claimId ||
    (queryError instanceof ApiError && (queryError.status === 404 || queryError.code === 'CLAIM_NOT_FOUND'))
      ? { kind: 'not-found' }
      : queryError
        ? {
            kind: 'error',
            message: queryError instanceof ApiError ? queryError.message : 'Something went wrong.',
          }
        : pair === null
          ? { kind: 'loading' }
          : { kind: 'ready', claim: pair.claim, slot: pair.slot };

  // State changes from panels and poll boxes (funded, released,
  // disputed…) arrive here as invalidations: the cached claim refetches
  // and the panel switches without a skeleton flash.
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId ?? '') });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/claims" className="inline-block min-h-touch py-2 text-body font-medium text-muted">
        ← Back to my holds
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <LoadingSkeleton rows={1} />
        ) : state.kind === 'error' ? (
          <ErrorState message={state.message} onRetry={() => void claimQuery.refetch()} />
        ) : state.kind === 'not-found' ? (
          <EmptyState
            title="Hold not found"
            body="It may belong to a different account, or the link is wrong."
            action={
              <Link
                to="/claims"
                className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
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

// Claim-side escrow statuses render the EscrowPanel. The
// escrow-internal transitional states (releasing/refunding) never appear
// on the claim row itself — the panel reads them from GET /escrow.
const ESCROW_CLAIM_STATUSES = [
  'deposit_submitted',
  'escrow_funded',
  'delivered',
  'disputed',
  'released',
  'refunded',
];

function ClaimBody({
  claim,
  slot,
  onSubmitted,
}: {
  claim: ClaimView;
  slot: PublicSlot;
  onSubmitted: () => void;
}) {
  // The escrow panel owns the amount for escrow states; legacy states
  // keep the compact header price so no amount ever hides.
  const panelRendered =
    claim.status === 'active_hold' || ESCROW_CLAIM_STATUSES.includes(claim.status);
  return (
    <article className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <CategoryIcon category={slot.category} />
          <div className="min-w-0">
            <h1 className="text-h1 font-bold text-text">{slot.title}</h1>
            <p className="mt-0.5 truncate text-small text-muted">By {slot.providerDisplay}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
          <ClaimStatusBadge status={claim.status} />
        </div>
        <p className="mt-2 font-mono text-small tabular-nums text-muted">
          Claimed {new Date(claim.claimed_at).toLocaleString()}.
        </p>
        {claim.status === 'active_hold' ? (
          <div className="mt-3">
            <HoldCountdown holdExpiresAt={claim.hold_expires_at} />
          </div>
        ) : null}
        {!panelRendered ? (
          <div className="mt-3">
            <PriceDisplay priceUsdt={slot.price_usdt} />
          </div>
        ) : null}
        {claim.status === 'active_hold' ? (
          <div className="mt-4">
            <EscrowPanel claim={claim} onUpdate={onSubmitted} />
          </div>
        ) : null}
        {ESCROW_CLAIM_STATUSES.includes(claim.status) ? (
          <div className="mt-4">
            <EscrowPanel claim={claim} onUpdate={onSubmitted} />
          </div>
        ) : null}
        {claim.status === 'payment_pending' ? (
          <VerifyPollBox claim={claim} onResolved={onSubmitted} />
        ) : null}
        {claim.status === 'payment_review' ? (
          <div className="mt-4 rounded-lg bg-surface-2 p-3">
            <p className="text-body font-medium text-warning">
              Payment under review. We&apos;ll be in touch.
            </p>
          </div>
        ) : null}
        {claim.status === 'expired' ? (
          <div className="mt-4 rounded-lg bg-surface-2 p-3">
            <p className="text-body font-medium text-muted">Hold expired</p>
            <Link
              to={`/slot/${slot.id}`}
              className="mt-1 inline-flex min-h-touch items-center text-body text-text underline"
            >
              Claim again
            </Link>
          </div>
        ) : null}
        {claim.status === 'paid' ? (
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-body text-muted">
            Paid.
          </p>
        ) : null}
        {claim.status !== 'active_hold' &&
        claim.status !== 'payment_pending' &&
        claim.status !== 'payment_review' &&
        claim.status !== 'expired' &&
        claim.status !== 'paid' &&
        !ESCROW_CLAIM_STATUSES.includes(claim.status) ? (
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-body text-muted">
            This hold is no longer active.
          </p>
        ) : null}
      </div>
    </article>
  );
}

// Status-only polling for a submitted payment. Polls POST
// verify-payment every 5s (up to 60 auto attempts) and backs off on RPC
// outages (15s) and rate limits (Retry-After, else 10s). Never retries the
// payment broadcast itself — the buyer already paid; this is status only.
type PollDisplay = 'checking' | 'pending' | 'rpc-down' | 'exhausted' | 'review';

function VerifyPollBox({ claim, onResolved }: { claim: ClaimView; onResolved: () => void }) {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [display, setDisplay] = useState<PollDisplay>('checking');
  const [confirmations, setConfirmations] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [manualBusy, setManualBusy] = useState(false);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  // The recorded hash, via the idempotent intent read (creates nothing new).
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

  // Auto-poll cycle: immediate first check, then scheduled follow-ups.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let autoAttempts = 0;

    const applyOutcome = (outcome: 'verified' | 'review' | 'pending' | 'rpc-down'): void => {
      if (outcome === 'verified' || outcome === 'review') {
        if (outcome === 'review') setDisplay('review');
        onResolvedRef.current();
        return;
      }
      if (outcome === 'rpc-down') {
        setDisplay('rpc-down');
      } else {
        setDisplay('pending');
      }
    };

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (autoAttempts >= VERIFY_POLL_MAX_ATTEMPTS) {
        setDisplay('exhausted');
        return;
      }
      autoAttempts += 1;
      setAttempts(autoAttempts);
      try {
        const { verification } = await verifyPayment(claim.id);
        if (cancelled) return;
        if (verification.status === 'verified') {
          applyOutcome('verified');
          return;
        }
        if (verification.status === 'review') {
          applyOutcome('review');
          return;
        }
        setConfirmations(
          typeof verification.confirmations === 'number' ? verification.confirmations : null,
        );
        applyOutcome('pending');
        const delay = nextVerifyPollDelayMs('pending');
        if (delay !== null) timer = setTimeout(() => void tick(), delay);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.code === 'RPC_UNAVAILABLE' || err.status === 503)) {
          applyOutcome('rpc-down');
          const delay = nextVerifyPollDelayMs('rpc-unavailable');
          if (delay !== null) timer = setTimeout(() => void tick(), delay);
        } else if (
          err instanceof ApiError &&
          (err.code === 'VERIFY_RATE_LIMITED' || err.status === 429)
        ) {
          const delay = nextVerifyPollDelayMs('rate-limited', err.retryAfterMs);
          if (delay !== null) timer = setTimeout(() => void tick(), delay);
        } else {
          // Claim left payment_pending (expired/cancelled) or auth lapsed:
          // let the parent reload the true state.
          onResolvedRef.current();
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [claim.id]);

  // Manual check: always available, independent of the auto budget.
  const handleManualCheck = (): void => {
    setManualBusy(true);
    void verifyPayment(claim.id)
      .then(({ verification }) => {
        if (verification.status === 'verified' || verification.status === 'review') {
          if (verification.status === 'review') setDisplay('review');
          onResolvedRef.current();
          return;
        }
        setConfirmations(
          typeof verification.confirmations === 'number' ? verification.confirmations : null,
        );
        setDisplay('pending');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.code === 'RPC_UNAVAILABLE' || err.status === 503)) {
          setDisplay('rpc-down');
        } else if (
          !(err instanceof ApiError && (err.code === 'VERIFY_RATE_LIMITED' || err.status === 429))
        ) {
          onResolvedRef.current();
        }
      })
      .finally(() => {
        setManualBusy(false);
      });
  };

  return (
    <div className="mt-4 rounded-lg bg-surface-2 p-3">
      {display === 'review' ? (
        <p className="text-body font-medium text-warning">
          Payment under review. We&apos;ll be in touch.
        </p>
      ) : display === 'exhausted' ? (
        <p className="text-body font-medium text-warning">
          Still pending. Tap to check again.
        </p>
      ) : display === 'rpc-down' ? (
        <p className="text-body font-medium text-warning">
          Verification is temporarily unavailable. Retrying automatically.
        </p>
      ) : confirmations !== null ? (
        <p className="font-mono text-body font-medium tabular-nums text-warning">
          Awaiting confirmation ({confirmations}/3)
        </p>
      ) : (
        <p className="text-body font-medium text-warning">
          {display === 'checking' ? 'Checking payment status…' : 'Awaiting confirmation.'}
        </p>
      )}
      {txHash ? <p className="mt-1 break-all font-mono text-small text-warning">{txHash}</p> : null}
      <p className="mt-1 font-mono text-small tabular-nums text-warning">
        Hold deadline was {new Date(claim.hold_expires_at).toLocaleString()}. Status checks only
        — your payment is never sent twice. {attempts > 0 ? `Checked ${attempts} time(s).` : null}
      </p>
      <button
        type="button"
        onClick={handleManualCheck}
        disabled={manualBusy}
        className="mt-3 min-h-touch rounded-lg border border-warning bg-surface px-4 py-2 text-body font-medium text-warning disabled:opacity-50"
      >
        {manualBusy ? 'Checking…' : 'Check status'}
      </button>
    </div>
  );
}
