// Availability is always text, never color alone.
const pill = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tabular-nums';

export default function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <span className={`${pill} bg-slate-200 text-slate-700`}>Sold out</span>;
  }
  if (available === 1) {
    return <span className={`${pill} bg-red-100 text-red-800`}>Only 1 left</span>;
  }
  if (available <= 3) {
    return <span className={`${pill} bg-orange-100 text-orange-900`}>Only {available} left</span>;
  }
  return <span className={`${pill} bg-emerald-100 text-emerald-900`}>{available} available</span>;
}
