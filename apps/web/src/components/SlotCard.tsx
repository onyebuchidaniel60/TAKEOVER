import { Link } from 'react-router-dom';
import { MapPin, Tag } from 'lucide-react';
import type { PublicSlot } from '../lib/slots';
import AvailabilityBadge from './AvailabilityBadge';
import PriceDisplay from './PriceDisplay';
import TimeBadge from './TimeBadge';

export default function SlotCard({ slot }: { slot: PublicSlot }) {
  return (
    <Link
      to={`/slot/${slot.id}`}
      className="block rounded-2xl border border-border bg-surface p-5 shadow-card transition-[box-shadow,transform] duration-ui ease-out-strong hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99] focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-h3 font-semibold text-text">{slot.title}</h2>
        <PriceDisplay priceUsdt={slot.price_usdt} />
      </div>
      <p className="mt-0.5 text-small text-muted">By {slot.providerDisplay}</p>
      {slot.description ? (
        <p className="mt-1 line-clamp-2 text-body leading-relaxed text-muted">{slot.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        <AvailabilityBadge available={slot.available_quantity} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-small font-medium text-muted">
        {slot.category ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
            <Tag size={12} aria-hidden="true" />
            {slot.category}
          </span>
        ) : null}
        {slot.location_label ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
            <MapPin size={12} aria-hidden="true" />
            {slot.location_label}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
