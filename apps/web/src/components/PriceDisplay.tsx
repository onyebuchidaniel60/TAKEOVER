import { formatUsdt } from '../lib/slots';

// Prominent exact price. Consumer language only — no crypto jargon.
export default function PriceDisplay({ priceUsdt, large = false }: { priceUsdt: string; large?: boolean }) {
  return (
    <span
      className={
        large
          ? 'text-2xl font-bold tabular-nums tracking-[-0.02em]'
          : 'text-base font-semibold tabular-nums tracking-[-0.01em]'
      }
      aria-label={`Price ${formatUsdt(priceUsdt)}`}
    >
      {formatUsdt(priceUsdt)}
    </span>
  );
}
