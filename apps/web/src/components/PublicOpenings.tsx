// A provider's published openings, on their public profile (Phase 5k-B).
//
// Uses the feed endpoint's `provider` filter (a username) rather than
// fetching a page and filtering client-side: the API caps `limit` at 50, so
// a client-side filter would silently truncate a provider with more than 50
// openings. The filter is server-side and exact.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { queryKeys } from '../lib/queryKeys';
import { fetchSlots } from '../lib/slots';
import PriceDisplay from './PriceDisplay';

const PREVIEW_LIMIT = 3;

export default function PublicOpenings({
  username,
  displayName,
}: {
  username: string;
  displayName: string;
}) {
  const slotsQuery = useQuery({
    queryKey: queryKeys.slots(`provider:${username}:${PREVIEW_LIMIT}`),
    queryFn: () => fetchSlots({ provider: username, limit: PREVIEW_LIMIT, offset: 0 }),
  });
  const mine = slotsQuery.data?.slots ?? [];

  if (slotsQuery.isPending) return null;
  if (mine.length === 0) return null;

  return (
    <section className="rounded-card border border-border bg-surface" aria-label="Openings">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-h3 font-semibold text-text">Openings</h2>
        <span className="text-small text-muted">{displayName}</span>
      </div>
      <ul className="divide-y divide-border">
        {mine.map((slot) => (
          <li key={slot.id}>
            <Link
              to={`/slot/${slot.id}`}
              className="flex min-h-touch items-center gap-3 px-4 py-3 transition-colors duration-ui ease-out-strong"
            >
              <span className="min-w-0 flex-1 truncate text-body text-text">{slot.title}</span>
              <PriceDisplay priceUsdt={slot.price_usdt} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
