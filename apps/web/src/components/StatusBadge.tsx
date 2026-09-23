// Status is always text, never color alone.
const STYLES: Record<string, string> = {
  draft: 'bg-surface-2 text-text',
  published: 'bg-surface-2 text-accent',
  sold_out: 'bg-surface-2 text-text',
  cancelled: 'bg-surface-2 text-danger',
  expired: 'bg-surface-2 text-warning',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: string }) {
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
