import { Link } from 'react-router-dom';
import type { PublicSlot } from '../lib/slots';
import AvailabilityBadge from './AvailabilityBadge';
import PriceDisplay from './PriceDisplay';
import TimeBadge from './TimeBadge';

export default function SlotCard({ slot }: { slot: PublicSlot }) {
  return (
    <Link
      to={`/slot/${slot.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug">{slot.title}</h2>
        <PriceDisplay priceNim={slot.price_nim} />
      </div>
      <p className="mt-0.5 text-xs text-slate-500">By {slot.providerDisplay}</p>
      {slot.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{slot.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        <AvailabilityBadge available={slot.available_quantity} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {slot.category ? <span>{slot.category}</span> : null}
        {slot.location_label ? <span>{slot.location_label}</span> : null}
      </div>
    </Link>
  );
}
