// Availability is always text, never color alone.
const pill =
  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-small font-medium tabular-nums';

export default function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <span className={`${pill} bg-surface-2 text-text`}>Sold out</span>;
  }
  if (available === 1) {
    return <span className={`${pill} bg-surface-2 text-danger`}>Only 1 left</span>;
  }
  if (available <= 3) {
    return <span className={`${pill} bg-surface-2 text-warning`}>Only {available} left</span>;
  }
  return <span className={`${pill} bg-surface-2 text-accent`}>{available} available</span>;
}
