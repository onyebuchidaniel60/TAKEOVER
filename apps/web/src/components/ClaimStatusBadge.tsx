// Claim status is always text, never color alone.
// Labels follow the locked status copy.
// Escrow states added (same text+color discipline).
const STYLES: Record<string, string> = {
  active_hold: 'bg-surface-2 text-accent',
  expired: 'bg-surface-2 text-text',
  cancelled: 'bg-surface-2 text-text',
  payment_pending: 'bg-surface-2 text-warning',
  paid: 'bg-surface-2 text-accent',
  payment_review: 'bg-surface-2 text-warning',
  deposit_submitted: 'bg-surface-2 text-warning',
  escrow_funded: 'bg-surface-2 text-accent',
  delivered: 'bg-surface-2 text-muted',
  disputed: 'bg-surface-2 text-warning',
  releasing: 'bg-surface-2 text-muted',
  released: 'bg-surface-2 text-accent',
  refunding: 'bg-surface-2 text-text',
  refunded: 'bg-surface-2 text-text',
};

const LABELS: Record<string, string> = {
  active_hold: 'On hold',
  expired: 'Hold expired',
  cancelled: 'Cancelled',
  payment_pending: 'Awaiting confirmation',
  paid: 'Paid',
  payment_review: 'Payment under review',
  deposit_submitted: 'Deposit submitted',
  escrow_funded: 'In escrow',
  delivered: 'Delivered',
  disputed: 'Disputed',
  releasing: 'Releasing',
  released: 'Released',
  refunding: 'Refunding',
  refunded: 'Refunded',
};

export default function ClaimStatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-surface-2 text-text';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-small font-medium ${style}`}
    >
      {label}
    </span>
  );
}
