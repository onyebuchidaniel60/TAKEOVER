// Phase 6: claim status is always text, never color alone.
// Phase 11: labels follow the locked status copy.
// Phase 14e P1: escrow states added (same text+color discipline).
const STYLES: Record<string, string> = {
  active_hold: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  expired: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
  payment_pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  payment_review: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  deposit_submitted: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  escrow_funded: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  delivered: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  disputed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  releasing: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  released: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  refunding: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
  refunded: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
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
  const style = STYLES[status] ?? 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-small font-medium ${style}`}
    >
      {label}
    </span>
  );
}
