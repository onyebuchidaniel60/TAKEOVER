// One held opening. Live countdown while the hold is live.
// Real payment panel for active holds; submitted/expired/paid states.
// Payment_pending polls verify-payment until the chain confirms.
// USDT escrow buyer loop replaces the deprecated direct-payment
// panel for escrow-active states; legacy payment_pending/review branches stay
// until zero legacy rows remain (§5 deprecation gates).
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
      <Link to="/claims" className="inline-block min-h-touch py-2 text-body font-medium text-taupe dark:text-drift">
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
                className="inline-block min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory dark:bg-sandlight dark:text-coal"
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
  return (
    <article className="overflow-hidden rounded-xl border border-hairline bg-cream dark:border-rootline dark:bg-cocoa">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ClaimStatusBadge status={claim.status} />
          {claim.status === 'active_hold' ? (
            <HoldCountdown holdExpiresAt={claim.hold_expires_at} />
          ) : null}
        </div>
        <h1 className="mt-3 text-h1 font-bold text-bark dark:text-parchment">{slot.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        </div>
        <div className="mt-4 border-t border-hairline pt-4 dark:border-rootline">
          <PriceDisplay priceUsdt={slot.price_usdt} large />
        </div>
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
          <div className="mt-4 rounded-lg bg-ochrewash p-3 dark:bg-ochrewashd">
            <p className="text-body font-medium text-ochre dark:text-ochred">
              Payment under review. We&apos;ll be in touch.
            </p>
          </div>
        ) : null}
        {claim.status === 'expired' ? (
          <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber">
            <p className="text-body font-medium text-taupe dark:text-khaki">Hold expired</p>
            <Link
              to={`/slot/${slot.id}`}
              className="mt-1 inline-flex min-h-touch items-center text-body text-bark underline dark:text-parchment"
            >
              Claim again
            </Link>
          </div>
        ) : null}
        {claim.status === 'paid' ? (
          <p className="mt-4 rounded-lg bg-sand p-3 text-body text-taupe dark:bg-umber dark:text-drift">
            Paid.
          </p>
        ) : null}
        {claim.status !== 'active_hold' &&
        claim.status !== 'payment_pending' &&
        claim.status !== 'payment_review' &&
        claim.status !== 'expired' &&
        claim.status !== 'paid' &&
        !ESCROW_CLAIM_STATUSES.includes(claim.status) ? (
          <p className="mt-4 rounded-lg bg-sand p-3 text-body text-taupe dark:bg-umber dark:text-drift">
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
    <div className="mt-4 rounded-lg bg-ochrewash p-3 dark:bg-ochrewashd">
      {display === 'review' ? (
        <p className="text-body font-medium text-ochre dark:text-ochred">
          Payment under review. We&apos;ll be in touch.
        </p>
      ) : display === 'exhausted' ? (
        <p className="text-body font-medium text-ochre dark:text-ochred">
          Still pending. Tap to check again.
        </p>
      ) : display === 'rpc-down' ? (
        <p className="text-body font-medium text-ochre dark:text-ochred">
          Verification is temporarily unavailable. Retrying automatically.
        </p>
      ) : confirmations !== null ? (
        <p className="font-mono text-body font-medium tabular-nums text-ochre dark:text-ochred">
          Awaiting confirmation ({confirmations}/3)
        </p>
      ) : (
        <p className="text-body font-medium text-ochre dark:text-ochred">
          {display === 'checking' ? 'Checking payment status…' : 'Awaiting confirmation.'}
        </p>
      )}
      {txHash ? <p className="mt-1 break-all font-mono text-small text-ochre dark:text-ochred">{txHash}</p> : null}
      <p className="mt-1 font-mono text-small tabular-nums text-ochre dark:text-ochred">
        Hold deadline was {new Date(claim.hold_expires_at).toLocaleString()}. Status checks only
        — your payment is never sent twice. {attempts > 0 ? `Checked ${attempts} time(s).` : null}
      </p>
      <button
        type="button"
        onClick={handleManualCheck}
        disabled={manualBusy}
        className="mt-3 min-h-touch rounded-lg border border-ochre bg-cream px-4 py-2 text-body font-medium text-ochre disabled:opacity-50 dark:border-ochred dark:bg-cocoa dark:text-ochred"
      >
        {manualBusy ? 'Checking…' : 'Check status'}
      </button>
    </div>
  );
}
