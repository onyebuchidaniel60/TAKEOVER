// Availability is always text, never color alone.
const pill =
  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-small font-medium tabular-nums';

export default function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <span className={`${pill} bg-slate-200 text-slate-700 dark:bg-stone-700 dark:text-stone-200`}>Sold out</span>;
  }
  if (available === 1) {
    return <span className={`${pill} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`}>Only 1 left</span>;
  }
  if (available <= 3) {
    return <span className={`${pill} bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300`}>Only {available} left</span>;
  }
  return <span className={`${pill} bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300`}>{available} available</span>;
}
