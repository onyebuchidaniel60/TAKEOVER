import type { PublicSlot } from '../lib/slots';
import AvailabilityBadge from './AvailabilityBadge';
import PriceDisplay from './PriceDisplay';
import TimeBadge from './TimeBadge';

// WHAT / WHEN / WHERE / HOW MUCH / HOW MANY LEFT. No claim action (Phase 6).
export default function SlotDetail({ slot }: { slot: PublicSlot }) {
  const when = new Date(slot.starts_at).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const soldOut = slot.available_quantity <= 0;
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
          <AvailabilityBadge available={slot.available_quantity} />
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{slot.title}</h1>
        <p className="mt-1 text-sm text-slate-500">By {slot.providerDisplay}</p>
        {slot.description ? <p className="mt-2 text-sm leading-relaxed text-slate-600">{slot.description}</p> : null}
        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">When</dt>
            <dd className="mt-1 font-medium">{when}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Where</dt>
            <dd className="mt-1 font-medium">{slot.location_label ?? 'See details'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Price</dt>
            <dd className="mt-1">
              <PriceDisplay priceUsdt={slot.price_usdt} large />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Spots left</dt>
            <dd className="mt-1 font-medium">
              {soldOut ? 'None — just missed it' : `${slot.available_quantity} of ${slot.total_quantity}`}
            </dd>
          </div>
        </dl>
        {slot.category ? (
          <p className="mt-4 text-xs text-slate-500">Category: {slot.category}</p>
        ) : null}
      </div>
    </article>
  );
}
