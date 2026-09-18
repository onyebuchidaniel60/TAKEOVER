import { Link } from 'react-router-dom';
import { ESCROW_BUCKET_STATUSES } from '../lib/slots';
import type { ClaimView } from '../lib/slots';
import ClaimStatusBadge from './ClaimStatusBadge';
import HoldCountdown from './HoldCountdown';

export default function ClaimCard({ claim }: { claim: ClaimView }) {
  const inEscrow = (ESCROW_BUCKET_STATUSES as readonly string[]).includes(claim.status);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <ClaimStatusBadge status={claim.status} />
        {claim.status === 'active_hold' ? (
          <HoldCountdown holdExpiresAt={claim.hold_expires_at} />
        ) : null}
      </div>
      <p className="mt-2 font-mono text-small tabular-nums text-slate-500 dark:text-stone-400">
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
          className="inline-flex min-h-touch items-center text-slate-900 underline dark:text-stone-100"
        >
          {inEscrow ? 'View escrow' : 'View hold'}
        </Link>
        <Link
          to={`/slot/${claim.slot_id}`}
          className="inline-flex min-h-touch items-center text-slate-600 underline dark:text-stone-400"
        >
          View opening
        </Link>
      </div>
    </div>
  );
}
