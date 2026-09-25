import type { PublicSlot } from '../lib/slots';
import { formatUsdt } from '../lib/slots';
import AvailabilityBadge from './AvailabilityBadge';
import Avatar from './Avatar';
import CategoryIcon from './CategoryIcon';
import TimeBadge from './TimeBadge';

// Slot detail (design.md §7): hero (category chip + h1 + provider),
// price card (surface, radius-card, mono figures), WHEN / WHERE /
// HOW MANY details, provider block. No claim action — the page owns
// the sticky CTA, so this component is pure content.
export default function SlotDetail({ slot }: { slot: PublicSlot }) {
  const when = new Date(slot.starts_at).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const soldOut = slot.available_quantity <= 0;
  // Exact BigInt math stays inside formatUsdt ("4.5 USDT"); the unit
  // renders as small muted text beside the mono amount (design.md §3.3:
  // figures are mono + tabular-nums so Poppins numerals never shift).
  const price = formatUsdt(slot.price_usdt);
  const amount = price.replace(/\s*USDT\s*$/, '');
  const image = slot.imageData ?? null;
  return (
    <article>
      {/* Opening image (optional): full-width hero above the title. */}
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="mb-4 aspect-[16/10] w-full rounded-card object-cover"
        />
      ) : null}
      {/* Hero: category identity, title, provider. */}
      <div className="flex items-start gap-3">
        <CategoryIcon category={slot.category} />
        <div className="min-w-0">
          <h1 className="text-h1 font-bold text-text">{slot.title}</h1>
          <p className="mt-0.5 truncate text-small text-muted">By {slot.providerDisplay}</p>
        </div>
      </div>
      {slot.description ? (
        <p className="mt-3 text-body leading-relaxed text-muted">{slot.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TimeBadge startsAt={slot.starts_at} endsAt={slot.ends_at} />
        <AvailabilityBadge available={slot.available_quantity} />
      </div>

      {/* Price: prominent mono amount, muted unit label. The exposed
          text reads as the accessible name ("4.5 USDT") — no aria-label
          wrapper (axe aria-prohibited-attr forbids naming a plain span). */}
      <section aria-label="Price" className="mt-4 rounded-card border border-border bg-surface p-4">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-display font-bold tabular-nums text-text">{amount}</span>
          <span className="text-small font-medium text-muted">USDT</span>
        </span>
      </section>

      {/* Details: stacked label-above-value rows on mobile, aligned
          two-column at sm+ (see DECISIONS.md: a 320px content column
          cannot host label + 30-char datetime side by side). */}
      <section
        aria-label="Details"
        className="mt-4 rounded-card border border-border bg-surface p-4"
      >
        <dl className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[96px_1fr] sm:gap-3">
            <dt className="text-small font-medium uppercase tracking-wide text-muted">When</dt>
            <dd className="font-mono text-body font-medium tabular-nums text-text">{when}</dd>
          </div>
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[96px_1fr] sm:gap-3">
            <dt className="text-small font-medium uppercase tracking-wide text-muted">Where</dt>
            <dd className="text-body font-medium text-text">{slot.location_label ?? 'See details'}</dd>
          </div>
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[96px_1fr] sm:gap-3">
            <dt className="text-small font-medium uppercase tracking-wide text-muted">How many</dt>
            <dd className="text-body font-medium text-text">
              {soldOut ? (
                'None — just missed it'
              ) : (
                <span className="font-mono tabular-nums">
                  {slot.available_quantity} of {slot.total_quantity}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Provider: avatar + display name. */}
      <section aria-label="Provider" className="mt-4 flex items-center gap-3">
        <Avatar data={slot.providerAvatar ?? null} name={slot.providerDisplay} size={32} />
        <p className="min-w-0 truncate text-body font-medium text-text">{slot.providerDisplay}</p>
      </section>
    </article>
  );
}
