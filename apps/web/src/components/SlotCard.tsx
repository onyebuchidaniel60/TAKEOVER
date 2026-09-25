import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { fetchSlot, type PublicSlot } from '../lib/slots';
import { queryKeys } from '../lib/queryKeys';
import AvailabilityBadge from './AvailabilityBadge';
import CategoryIcon from './CategoryIcon';
import PriceDisplay from './PriceDisplay';
import TimeBadge from './TimeBadge';

// Feed card (design.md §7): surface, radius-card, 16px padding, no
// shadow, no hover-lift. The whole card is a link, so press feedback
// is scale(0.99). Category identity rides the icon chip (D5); title in
// h2; time + location meta; price left, availability right — every
// figure in mono + tabular-nums.
//
// Hover/touch-start prefetches the detail query so the slot page often
// opens on warm cache. Visuals and navigation are untouched.
export default function SlotCard({ slot }: { slot: PublicSlot }) {
  const queryClient = useQueryClient();
  const prefetch = (): void => {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.slot(slot.id),
      queryFn: () => fetchSlot(slot.id).then((r) => r.slot),
      staleTime: 30_000,
    });
  };
  return (
    <Link
      to={`/slot/${slot.id}`}
      onMouseEnter={prefetch}
      onPointerDown={prefetch}
      className="block rounded-card border border-border bg-surface p-4 transition-transform duration-press ease-out-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99] motion-reduce:transition-none"
    >
      <div className="flex items-start gap-3">
        <CategoryIcon category={slot.category} />
        <div className="min-w-0">
          <h2 className="text-h2 font-semibold text-text">{slot.title}</h2>
          <p className="mt-0.5 truncate text-small text-muted">By {slot.providerDisplay}</p>
        </div>
      </div>
      {slot.description ? (
        <p className="mt-3 line-clamp-2 text-body leading-relaxed text-muted">{slot.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        {slot.location_label ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-small font-medium text-muted">
            <MapPin size={12} aria-hidden="true" />
            {slot.location_label}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-border pt-3">
        <PriceDisplay priceUsdt={slot.price_usdt} />
        <AvailabilityBadge available={slot.available_quantity} />
      </div>
    </Link>
  );
}
