import type { PublicSlot } from '../lib/slots';
import AvailabilityBadge from './AvailabilityBadge';
import PriceDisplay from './PriceDisplay';
import TimeBadge from './TimeBadge';

// WHAT / WHEN / WHERE / HOW MUCH / HOW MANY LEFT. No claim action.
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
    <article className="overflow-hidden rounded-xl border border-hairline bg-cream dark:border-rootline dark:bg-cocoa">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
          <AvailabilityBadge available={slot.available_quantity} />
        </div>
        <h1 className="mt-3 text-h1 font-bold text-bark dark:text-parchment">{slot.title}</h1>
        <p className="mt-1 text-body text-muted dark:text-drift">By {slot.providerDisplay}</p>
        {slot.description ? <p className="mt-2 text-body leading-relaxed text-taupe dark:text-drift">{slot.description}</p> : null}
        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-hairline pt-4 text-body text-bark dark:border-rootline dark:text-parchment sm:grid-cols-2">
          <div>
            <dt className="text-small font-medium uppercase tracking-wide text-muted dark:text-drift">When</dt>
            <dd className="mt-1 font-medium">{when}</dd>
          </div>
          <div>
            <dt className="text-small font-medium uppercase tracking-wide text-muted dark:text-drift">Where</dt>
            <dd className="mt-1 font-medium">{slot.location_label ?? 'See details'}</dd>
          </div>
          <div>
            <dt className="text-small font-medium uppercase tracking-wide text-muted dark:text-drift">Price</dt>
            <dd className="mt-1">
              <PriceDisplay priceUsdt={slot.price_usdt} large />
            </dd>
          </div>
          <div>
            <dt className="text-small font-medium uppercase tracking-wide text-muted dark:text-drift">Spots left</dt>
            <dd className="mt-1 font-medium">
              {soldOut ? 'None — just missed it' : `${slot.available_quantity} of ${slot.total_quantity}`}
            </dd>
          </div>
        </dl>
        {slot.category ? (
          <p className="mt-4 text-small text-muted dark:text-drift">Category: {slot.category}</p>
        ) : null}
      </div>
    </article>
  );
}
