import { formatNim } from '../lib/slots';

// Prominent exact price. Consumer language only — no crypto jargon.
export default function PriceDisplay({ priceNim, large = false }: { priceNim: string; large?: boolean }) {
  return (
    <span className={large ? 'text-2xl font-bold' : 'text-base font-semibold'} aria-label={`Price ${formatNim(priceNim)}`}>
      {formatNim(priceNim)}
    </span>
  );
}
