// Claim status is always text, never color alone.
// Labels follow the locked status copy.
// Escrow states added (same text+color discipline).
const STYLES: Record<string, string> = {
  active_hold: 'bg-sagewash text-sage dark:bg-sagewashd dark:text-saged',
  expired: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
  cancelled: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
  payment_pending: 'bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred',
  paid: 'bg-sagewash text-sage dark:bg-sagewashd dark:text-saged',
  payment_review: 'bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred',
  deposit_submitted: 'bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred',
  escrow_funded: 'bg-sagewash text-sage dark:bg-sagewashd dark:text-saged',
  delivered: 'bg-sand text-taupe dark:bg-umber dark:text-khaki',
  disputed: 'bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred',
  releasing: 'bg-sand text-taupe dark:bg-umber dark:text-khaki',
  released: 'bg-sagewash text-sage dark:bg-sagewashd dark:text-saged',
  refunding: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
  refunded: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
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
  const style = STYLES[status] ?? 'bg-sand text-taupe dark:bg-umber dark:text-parchment';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-small font-medium ${style}`}
    >
      {label}
    </span>
  );
}
