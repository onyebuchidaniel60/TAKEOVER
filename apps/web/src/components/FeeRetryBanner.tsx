// Listing-fee status surface (Phase 5n-C, D24).
//
// Replaces the old "Payment sent — retry with the same transaction" banner
// and its "Retry publish" button. A fee that is on-chain but not yet at 3
// confirmations is a WAITING state, not a failure, so this renders progress
// and nothing else. Only a HARD failure (mismatch/replay/invalid — a hash
// that can never publish this slot) offers an action, and that action is a
// NEW payment, because retrying the same hash would fail identically
// forever.
import type { ReactNode } from 'react';

export const RETRYABLE_FEE_CODES: ReadonlySet<string> = new Set([
  'PAYMENT_NOT_CONFIRMED',
  'PAYMENT_NOT_FOUND',
  'RPC_UNAVAILABLE',
]);

export interface FeeFailure {
  code: string;
  message: string;
}

export default function FeeRetryBanner({
  feeFailure,
  publishing,
  confirm,
  handover,
  onNewPayment,
}: {
  feeFailure: FeeFailure | null;
  publishing: boolean;
  /** Live confirmation count, read from the error meta. */
  confirm: { confirmations: number | null; required: number } | null;
  /** Poll budget spent: the publish will still land, server-side. */
  handover: boolean;
  onNewPayment: () => void;
}) {
  const retryable = feeFailure === null || RETRYABLE_FEE_CODES.has(feeFailure.code);

  if (retryable) {
    const line: ReactNode = handover
      ? "Still confirming. You can leave this page — your opening will publish as soon as the payment confirms."
      : publishing
        ? 'Confirming your payment…'
        : 'Payment sent. Waiting for confirmations…';
    return (
      <div
        className="rounded-lg border border-warning bg-surface-2 p-3 text-body text-warning"
        role="status"
        aria-live="polite"
      >
        <p className="font-medium">{line}</p>
        {confirm && confirm.confirmations !== null ? (
          <p className="mt-1 text-body text-muted" data-testid="fee-confirmations">
            Confirming {confirm.confirmations}/{confirm.required}…
          </p>
        ) : null}
        {confirm && confirm.confirmations === null ? (
          <p className="mt-1 text-body text-muted">Waiting for the payment to appear on the network…</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-warning bg-surface-2 p-3 text-body text-warning"
      role="alert"
    >
      <p className="font-medium">Payment sent but the opening could not be published.</p>
      {feeFailure ? <p className="mt-1 text-body text-muted">{feeFailure.message}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onNewPayment}
          className="min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
        >
          Pay again
        </button>
      </div>
    </div>
  );
}
