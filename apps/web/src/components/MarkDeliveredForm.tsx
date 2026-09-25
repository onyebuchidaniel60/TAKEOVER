// Provider payout-address form for one escrow_funded claim.
// Submits POST mark-delivered with the provider's EVM payout address
// (0x + 40 hex — validated client-side for UX, authoritatively server-side,
// stored lowercased and immutably). Idempotent resubmits of the same address
// are 200 no-ops; a different address is 409 CONFLICT (immutable after the
// first success — surfaced as support copy, never auto-corrected).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, markDelivered } from '../lib/escrow';
import { queryKeys } from '../lib/queryKeys';

function isEvmAddress(value: string): boolean {
  return /^0[xX][0-9a-fA-F]{40}$/.test(value.trim());
}

export default function MarkDeliveredForm({
  claimId,
  onDelivered,
}: {
  claimId: string;
  onDelivered: () => void;
}) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  // Delivery flips claim + escrow states: invalidate both plus the
  // provider demand list (counts change). The parent refresh covers
  // the list; invalidations cover every cache.
  const deliverMutation = useMutation({
    mutationFn: (payoutAddress: string) => markDelivered(claimId, payoutAddress),
    onSuccess: () => {
      setDone(true);
      onDelivered();
      void queryClient.invalidateQueries({ queryKey: queryKeys.escrow(claimId) });
      void queryClient.invalidateQueries({ queryKey: ['slot-claims'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        setError(
          'This escrow already has a different payout address recorded. Payout addresses can’t be changed after delivery — contact support if this is wrong.',
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      }
    },
  });
  const busy = deliverMutation.isPending;

  const submit = (): void => {
    const trimmed = address.trim();
    if (!isEvmAddress(trimmed)) {
      setError('Enter a valid payout address (0x followed by 40 hex characters).');
      return;
    }
    setError(null);
    deliverMutation.mutate(trimmed);
  };

  if (done) {
    return (
      <p className="mt-2 text-body font-medium text-text" aria-live="polite">
        Marked delivered.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <label htmlFor={`payout-${claimId}`} className="block text-body font-medium text-muted">
        Provider payout address (Polygon)
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          id={`payout-${claimId}`}
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          className="min-h-touch flex-1 rounded-lg border border-border-strong px-3 py-2 font-mono text-body text-text placeholder:text-muted bg-surface placeholder:text-muted"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex min-h-touch items-center rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
        >
          {busy ? 'Marking…' : 'Mark delivered'}
        </button>
      </div>
      {error && (
        <p className="mt-1 text-body text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
