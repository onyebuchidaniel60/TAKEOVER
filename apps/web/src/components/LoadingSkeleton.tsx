// Card-shaped skeleton: mirrors the feed card layout exactly (chip +
// title lines, description lines, two meta pills, price + availability
// row) so content swaps in without layout shift. animate-pulse is the
// existing shimmer; the global reduced-motion blanket stops it.
export default function LoadingSkeleton({
  rows = 3,
  label = 'Loading available slots',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-card border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-surface-2" />
            <div className="min-w-0 flex-1">
              <div className="h-5 w-2/3 rounded bg-surface-2" />
              <div className="mt-1 h-3 w-1/3 rounded bg-surface-2" />
            </div>
          </div>
          <div className="mt-3 h-3.5 w-full rounded bg-surface-2" />
          <div className="mt-1 h-3.5 w-4/5 rounded bg-surface-2" />
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-28 rounded-full bg-surface-2" />
            <div className="h-6 w-20 rounded-full bg-surface-2" />
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
            <div className="h-6 w-24 rounded bg-surface-2" />
            <div className="h-6 w-20 rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
