// Status is always text, never color alone.
const STYLES: Record<string, string> = {
  draft: 'bg-slate-200 text-slate-700',
  published: 'bg-emerald-100 text-emerald-900',
  sold_out: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-red-100 text-red-800',
  expired: 'bg-amber-100 text-amber-900',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: string }) {
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
