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
        <div key={i} className="animate-pulse rounded-2xl border border-stone-200 bg-white p-5">
          <div className="h-4 w-2/3 rounded bg-stone-200" />
          <div className="mt-2 h-3 w-full rounded bg-stone-100" />
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-24 rounded-full bg-stone-100" />
            <div className="h-6 w-20 rounded-full bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
