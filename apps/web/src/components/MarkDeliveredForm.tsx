// Phase 14e P2: provider payout-address form for one escrow_funded claim.
// Submits POST mark-delivered with the provider's EVM payout address
// (0x + 40 hex — validated client-side for UX, authoritatively server-side,
// stored lowercased and immutably). Idempotent resubmits of the same address
// are 200 no-ops; a different address is 409 CONFLICT (immutable after the
// first success — surfaced as support copy, never auto-corrected).
import { useState } from 'react';
import { ApiError, markDelivered } from '../lib/escrow';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (): void => {
    const trimmed = address.trim();
    if (!isEvmAddress(trimmed)) {
      setError('Enter a valid payout address (0x followed by 40 hex characters).');
      return;
    }
    setError(null);
    setBusy(true);
    void markDelivered(claimId, trimmed)
      .then(() => {
        setDone(true);
        onDelivered();
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'CONFLICT') {
          setError(
            'This escrow already has a different payout address recorded. Payout addresses can’t be changed after delivery — contact support if this is wrong.',
          );
        } else {
          setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        }
      })
      .finally(() => setBusy(false));
  };

  if (done) {
    return (
      <p className="mt-2 text-sm font-medium text-slate-900" aria-live="polite">
        Marked delivered.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <label htmlFor={`payout-${claimId}`} className="block text-sm font-medium text-slate-700">
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
          className="min-h-touch flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex min-h-touch items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Marking…' : 'Mark delivered'}
        </button>
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
