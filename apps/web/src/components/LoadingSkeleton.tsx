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
        <div key={i} className="animate-pulse rounded-2xl border border-hairline bg-cream p-5 dark:border-rootline dark:bg-cocoa">
          <div className="h-4 w-2/3 rounded bg-sand dark:bg-umber" />
          <div className="mt-2 h-3 w-full rounded bg-sand dark:bg-umber" />
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-24 rounded-full bg-sand dark:bg-umber" />
            <div className="h-6 w-20 rounded-full bg-sand dark:bg-umber" />
          </div>
        </div>
      ))}
    </div>
  );
}
