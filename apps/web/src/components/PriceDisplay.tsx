import { formatUsdt } from '../lib/slots';

// Prominent exact price. Consumer language only — no crypto jargon.
export default function PriceDisplay({ priceUsdt, large = false }: { priceUsdt: string; large?: boolean }) {
  return (
    <span
      className={
        large
          ? 'text-display font-bold font-mono tabular-nums text-slate-900 dark:text-stone-100'
          : 'text-h3 font-semibold font-mono tabular-nums text-slate-900 dark:text-stone-100'
      }
      aria-label={`Price ${formatUsdt(priceUsdt)}`}
    >
      {formatUsdt(priceUsdt)}
    </span>
  );
}
