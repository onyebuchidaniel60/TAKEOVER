// Availability is always text, never color alone.
export default function AvailabilityBadge({ available }: { available: number }) {
  if (available <= 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
        Sold out
      </span>
    );
  }
  if (available === 1) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
        Only 1 left
      </span>
    );
  }
  if (available <= 3) {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-900">
        Only {available} left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
      {available} available
    </span>
  );
}
