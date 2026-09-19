// Verify-deposit polling box (buyer loop).
// Polls POST verify-deposit on the plan cadence (6 s, cap 60 attempts ≈
// 6 min; the per-claim limiter is 1/5 s). Stops on funded / mismatch /
// review; backs off on 503 / 429 with Retry-After. Manual check always
// available. Structure mirrors VerifyPollBox (approach, not code).
import { useEffect, useState } from 'react';
import {
  ApiError,
  VERIFY_DEPOSIT_INTERVAL_MS,
  VERIFY_DEPOSIT_MAX_ATTEMPTS,
  nextEscrowPollDelayMs,
  verifyDeposit,
} from '../lib/escrow';

type Display =
  | 'checking'
  | 'pending'
  | 'mismatch'
  | 'review'
  | 'rpc-down'
  | 'exhausted';

export default function VerifyDepositBox({
  claimId,
  onFunded,
}: {
  claimId: string;
  onFunded: () => void;
}) {
  const [display, setDisplay] = useState<Display>('checking');
  const [reason, setReason] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let autoAttempts = 0;

    const schedule = (delayMs: number): void => {
      if (cancelled) return;
      timer = setTimeout(() => void check(false), delayMs);
    };

    const check = async (manual: boolean): Promise<void> => {
      if (cancelled) return;
      if (!manual) {
        autoAttempts += 1;
        setAttempts(autoAttempts);
      }
      setDisplay((d) => (d === 'checking' || manual ? 'checking' : d));
      try {
        const result = await verifyDeposit(claimId);
        if (cancelled) return;
        if (result.status === 'funded') {
          onFunded();
          return;
        }
        if (result.status === 'mismatch') {
          setReason(result.reason ?? 'mismatch');
          setDisplay('mismatch');
          return;
        }
        if (result.status === 'review') {
          setDisplay('review');
          return;
        }
        // Pending: keep polling until the cap, then park as exhausted.
        if (!manual && autoAttempts >= VERIFY_DEPOSIT_MAX_ATTEMPTS) {
          setDisplay('exhausted');
          return;
        }
        setDisplay('pending');
        schedule(VERIFY_DEPOSIT_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.code === 'ESCROW_CONTRACT_UNAVAILABLE' || err.status === 503)) {
          setDisplay('rpc-down');
          const delay = nextEscrowPollDelayMs('rpc-unavailable', VERIFY_DEPOSIT_INTERVAL_MS);
          if (delay !== null && !manual) schedule(delay);
          return;
        }
        if (err instanceof ApiError && (err.code === 'VERIFY_RATE_LIMITED' || err.status === 429)) {
          const delay = nextEscrowPollDelayMs('rate-limited', VERIFY_DEPOSIT_INTERVAL_MS, err.retryAfterMs);
          if (delay !== null && !manual) schedule(delay);
          return;
        }
        setReason(err instanceof ApiError ? err.message : 'Something went wrong.');
        setDisplay('mismatch');
      }
    };

    void check(false);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Single auto-poll chain per claim; manual checks bypass the counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  const manualCheck = (): void => {
    setManualBusy(true);
    void verifyDeposit(claimId)
      .then((result) => {
        if (result.status === 'funded') {
          onFunded();
          return;
        }
        if (result.status === 'mismatch') {
          setReason(result.reason ?? 'mismatch');
          setDisplay('mismatch');
          return;
        }
        if (result.status === 'review') {
          setDisplay('review');
          return;
        }
        setDisplay('pending');
      })
      .catch((err: unknown) => {
        setReason(err instanceof ApiError ? err.message : 'Something went wrong.');
        setDisplay('mismatch');
      })
      .finally(() => setManualBusy(false));
  };

  return (
    <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
      {display === 'checking' && <p className="text-body text-taupe dark:text-drift">Checking deposit status…</p>}
      {display === 'pending' && (
        <p className="font-mono text-body tabular-nums text-taupe dark:text-drift">
          Deposit seen, waiting for confirmation… (check {attempts} of {VERIFY_DEPOSIT_MAX_ATTEMPTS})
        </p>
      )}
      {display === 'mismatch' && (
        <div>
          <p className="text-body font-medium text-bark dark:text-parchment">Deposit doesn&apos;t match.</p>
          <p className="mt-1 text-body text-taupe dark:text-drift">
            {reason === 'amount' || reason === 'escrow_id'
              ? 'The transaction details differ from this claim. If you already paid, contact support — do not pay again.'
              : 'We could not match a deposit for this claim yet. If you already paid, contact support — do not pay again.'}
          </p>
        </div>
      )}
      {display === 'review' && (
        <p className="text-body font-medium text-ochre dark:text-ochred">
          Verification timed out. The claim is under review — we&apos;ll be in touch.
        </p>
      )}
      {display === 'rpc-down' && (
        <p className="text-body text-taupe dark:text-drift">
          Network status is temporarily unavailable. We&apos;ll keep checking.
        </p>
      )}
      {display === 'exhausted' && (
        <p className="text-body text-taupe dark:text-drift">
          Still pending. The deposit may need more time — check again.
        </p>
      )}
      <button
        type="button"
        onClick={manualCheck}
        disabled={manualBusy}
        className="mt-2 inline-flex min-h-touch items-center rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-bark disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-parchment"
      >
        {manualBusy ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}
