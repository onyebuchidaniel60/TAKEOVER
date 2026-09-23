export default function LoadingSkeleton({
  rows = 3,
  label = 'Loading available slots',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-border bg-surface p-5">
          <div className="h-4 w-2/3 rounded bg-surface-2" />
          <div className="mt-2 h-3 w-full rounded bg-surface-2" />
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-24 rounded-full bg-surface-2" />
            <div className="h-6 w-20 rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
