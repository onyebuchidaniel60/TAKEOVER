// Availability is always text, never color alone.
const pill =
  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-small font-medium tabular-nums';

export default function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return <span className={`${pill} bg-sand text-taupe dark:bg-umber dark:text-parchment`}>Sold out</span>;
  }
  if (available === 1) {
    return <span className={`${pill} bg-claywash text-clay dark:bg-claywashd dark:text-clayd`}>Only 1 left</span>;
  }
  if (available <= 3) {
    return <span className={`${pill} bg-ochrewash text-ochre dark:bg-ochrewashd dark:text-ochred`}>Only {available} left</span>;
  }
  return <span className={`${pill} bg-sagewash text-sage dark:bg-sagewashd dark:text-saged`}>{available} available</span>;
}
