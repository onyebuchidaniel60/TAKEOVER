import { formatUsdt } from '../lib/slots';

// Prominent exact price. Consumer language only — no crypto jargon.
// The exposed text ("4.5 USDT") IS the accessible name: no aria-label
// wrapper (axe aria-prohibited-attr forbids naming a plain span, and
// the label would only duplicate the content for screen readers).
export default function PriceDisplay({ priceUsdt, large = false }: { priceUsdt: string; large?: boolean }) {
  return (
    <span
      className={
        large
          ? 'text-display font-bold font-mono tabular-nums text-text'
          : 'text-h3 font-semibold font-mono tabular-nums text-text'
      }
    >
      {formatUsdt(priceUsdt)}
    </span>
  );
}
