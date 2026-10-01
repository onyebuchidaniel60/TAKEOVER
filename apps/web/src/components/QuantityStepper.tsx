// Quantity stepper (Phase 5n-D).
//
// Treatment: a stepper, not a native <select>. Three reasons, in order of
// weight:
//   1. A native select opens a full-screen wheel on iOS/Android. That is a
//      jarring, high-ceremony interruption for what is almost always a
//      one-or-two-tap decision in a restrained consumer surface.
//   2. The live TOTAL is the point of choosing a quantity ("3 slots = 4.5
//      USDT"). With a select, the number only appears after the menu closes;
//      a stepper updates the total on every tap, so the price is never a
//      surprise at the CTA.
//   3. Bounds are structural. Minus is disabled at 1 and plus at the slot's
//      available quantity, so an out-of-range value is unrepresentable rather
//      than merely rejected later.
//
// Copy is consumer language ("How many?"), never "quantity" — the brief's
// instruction, and consistent with how the rest of the app talks about spots.
//
// Accessibility: the visible value and total are ordinary content (readable
// while navigating), and ONE visually-hidden live region announces the whole
// new state on change. Two live regions would double-announce every tap.
import { Minus, Plus } from 'lucide-react';
import { claimTotalBaseUnits, formatUsdt } from '../lib/slots';

export default function QuantityStepper({
  value,
  max,
  unitPriceBaseUnits,
  onChange,
}: {
  /** Units currently chosen. Always within [1, max]. */
  value: number;
  /** Slot availability — the hard upper bound. */
  max: number;
  /** Slot unit price in base units; the total is exact BigInt math. */
  unitPriceBaseUnits: string;
  onChange: (next: number) => void;
}) {
  const atMin = value <= 1;
  const atMax = value >= max;
  // Exact base-unit math, never a float: 0.1 x 3 must not read
  // 0.30000000000000004. Shared with the claim/claims displays so the figure
  // shown here and the one charged cannot drift.
  const total = formatUsdt(claimTotalBaseUnits(unitPriceBaseUnits, value));
  const unit = total.replace(/\s*USDT\s*$/, '');
  const slotsLabel = value === 1 ? 'slot' : 'slots';

  const stepButton =
    'flex h-11 w-11 min-h-touch items-center justify-center rounded-full border border-border-strong bg-surface text-text transition-transform duration-press ease-out-strong active:scale-[0.94] disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none';

  return (
    <section
      aria-labelledby="quantity-stepper-label"
      className="rounded-card border border-border bg-surface p-4"
    >
      <p
        id="quantity-stepper-label"
        className="text-small font-medium uppercase tracking-wide text-muted"
      >
        How many?
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange(value - 1)}
            disabled={atMin}
            aria-label="One fewer slot"
            className={stepButton}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          {/* tabular-nums so the figure does not shift width as it counts
              9 -> 10 — the mono/tabular pairing the price card already uses. */}
          <span className="min-w-[3ch] text-center font-mono text-h2 font-bold tabular-nums text-text">
            {value}
          </span>
          <button
            type="button"
            onClick={() => onChange(value + 1)}
            disabled={atMax}
            aria-label="One more slot"
            className={stepButton}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {/* The total is what makes the choice legible: it states the money
            consequence of the number before the user commits to it. */}
        <p className="text-right">
          <span className="block text-small text-muted">
            {value} {slotsLabel}
          </span>
          <span className="block font-mono text-body font-bold tabular-nums text-text">
            {unit} <span className="text-small font-medium text-muted">USDT</span>
          </span>
        </p>
      </div>
      <p className="mt-2 text-small text-faint">
        {max} {max === 1 ? 'slot' : 'slots'} available
      </p>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {value} {slotsLabel} selected. Total {total}.
      </p>
    </section>
  );
}