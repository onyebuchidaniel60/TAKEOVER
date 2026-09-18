// Status is always text, never color alone.
const STYLES: Record<string, string> = {
  draft: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
  published: 'bg-sagewash text-sage dark:bg-sagewashd dark:text-saged',
  sold_out: 'bg-sand text-taupe dark:bg-umber dark:text-parchment',
  cancelled: 'bg-claywash text-clay dark:bg-claywashd dark:text-clayd',
  expired: 'bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: string }) {
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
