import { formatUsdt } from '../lib/slots';

// Prominent exact price. Consumer language only — no crypto jargon.
export default function PriceDisplay({ priceUsdt, large = false }: { priceUsdt: string; large?: boolean }) {
  return (
    <span className={large ? 'text-2xl font-bold' : 'text-base font-semibold'} aria-label={`Price ${formatUsdt(priceUsdt)}`}>
      {formatUsdt(priceUsdt)}
    </span>
  );
}
