import { Link } from 'react-router-dom';
import { ESCROW_BUCKET_STATUSES } from '../lib/slots';
import type { ClaimView } from '../lib/slots';
import ClaimStatusBadge from './ClaimStatusBadge';
import HoldCountdown from './HoldCountdown';

export default function ClaimCard({ claim }: { claim: ClaimView }) {
  const inEscrow = (ESCROW_BUCKET_STATUSES as readonly string[]).includes(claim.status);
  // Phase 5n-D: shown only above one unit. Every pre-5n-D claim is quantity 1,
  // and a "1 slot" chip on every row would be pure clutter — the number only
  // earns space when it tells the buyer they hold more than one.
  const quantity = claim.quantity ?? 1;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        {/* Badge + quantity travel together as the claim's identity; the
            countdown stays right-aligned. Three children in a justify-between
            row would space them apart instead of pairing them. */}
        <span className="flex min-w-0 items-center gap-2">
          <ClaimStatusBadge status={claim.status} />
          {quantity > 1 ? (
            <span className="truncate rounded-pill bg-surface-2 px-3 py-1 text-small font-medium text-muted">
              {quantity} slots
            </span>
          ) : null}
        </span>
        {claim.status === 'active_hold' ? (
          <HoldCountdown holdExpiresAt={claim.hold_expires_at} />
        ) : null}
      </div>
      <p className="mt-2 font-mono text-small tabular-nums text-muted">
        Held since{' '}
        {new Date(claim.claimed_at).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </p>
      <div className="mt-3 flex gap-4 text-body font-medium">
        <Link
          to={`/claim/${claim.id}`}
          className="inline-flex min-h-touch items-center text-text underline"
        >
          {inEscrow ? 'View escrow' : 'View hold'}
        </Link>
        <Link
          to={`/slot/${claim.slot_id}`}
          className="inline-flex min-h-touch items-center text-muted underline"
        >
          View opening
        </Link>
      </div>
    </div>
  );
}
