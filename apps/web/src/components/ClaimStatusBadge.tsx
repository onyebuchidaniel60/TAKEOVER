// Phase 6: claim status is always text, never color alone.
// Phase 11: labels follow the locked status copy.
const STYLES: Record<string, string> = {
  active_hold: 'bg-emerald-100 text-emerald-900',
  expired: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-700',
  payment_pending: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-900',
  payment_review: 'bg-amber-100 text-amber-900',
};

const LABELS: Record<string, string> = {
  active_hold: 'On hold',
  expired: 'Hold expired',
  cancelled: 'Cancelled',
  payment_pending: 'Awaiting confirmation',
  paid: 'Paid',
  payment_review: 'Payment under review',
};

export default function ClaimStatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-slate-200 text-slate-700';
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}
