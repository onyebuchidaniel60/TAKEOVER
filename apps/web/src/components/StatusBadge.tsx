// Status is always text, never color alone.
const STYLES: Record<string, string> = {
  draft: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
  published: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  sold_out: 'bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  expired: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: string }) {
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
