// /Admin/payment-reviews — full reconciliation context per row
// (full buyer wallet + intent terms; deliberately more than buyers or
// providers ever see). Confirming paid is an admin override: no chain
// re-check happens.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTable from '../../components/AdminTable';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import ResolveDialog from '../../components/ResolveDialog';
import { ApiError } from '../../lib/api';
import { usePageMeta } from '../../lib/meta';
import { fetchPaymentReviews, resolvePaymentReview, type PaymentReview } from '../../lib/admin';
import { formatUsdt } from '../../lib/slots';

const PAGE_SIZE = 20;

export default function AdminPaymentReviews() {
  usePageMeta({ title: 'Payment reviews — TAKEOVER', robots: 'noindex' });
  const [reviews, setReviews] = useState<PaymentReview[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<PaymentReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchPaymentReviews({ limit: PAGE_SIZE, offset })
      .then((res) => {
        setReviews(res.reviews);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
  }, [offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/admin" className="inline-block min-h-touch py-2 text-body font-medium text-taupe dark:text-drift">
        ← Moderation
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-bark dark:text-parchment">Payment reviews</h1>
      <p className="mt-1 font-mono text-body tabular-nums text-muted dark:text-drift">
        {total} claim{total === 1 ? '' : 's'} awaiting a decision
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-sagewash p-3 text-body text-sage dark:bg-sagewashd dark:text-saged">
          {notice}
        </p>
      ) : null}
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : reviews.length === 0 ? (
          <EmptyState title="Nothing under review" body="Claims with unclear payments will show up here." />
        ) : (
          <>
            <AdminTable
              label="Payments under review"
              headers={['Claim', 'Terms', 'Transaction', 'Action']}
            >
              {reviews.map((r) => (
                <tr key={r.claim.id} className="border-b border-hairline last:border-0 dark:border-rootline">
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{r.slot.title}</p>
                    <p className="break-all font-mono text-small text-muted dark:text-drift">Buyer: {r.claim.buyerWallet}</p>
                    <p className="font-mono text-small tabular-nums text-muted dark:text-drift">
                      Claimed {new Date(r.claim.claimed_at).toLocaleString()}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-small">
                    <p className="font-mono tabular-nums">{formatUsdt(r.slot.price_usdt)}</p>
                    <p className="break-all font-mono text-muted dark:text-drift">To: {r.slot.payout_wallet}</p>
                    {r.intent ? (
                      <p className="break-all font-mono text-muted dark:text-drift">Data: {r.intent.expected_data}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-small">
                    {r.intent?.tx_hash ? (
                      <p className="break-all font-mono">{r.intent.tx_hash}</p>
                    ) : (
                      <p className="text-muted dark:text-drift">No transaction recorded</p>
                    )}
                    {r.intent?.submitted_at ? (
                      <p className="font-mono tabular-nums text-muted dark:text-drift">
                        Sent {new Date(r.intent.submitted_at).toLocaleString()}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setResolving(r)}
                      className="min-h-touch rounded-lg border border-borderwarm px-3 py-1 text-body font-medium text-taupe dark:border-rootedge dark:bg-cocoa dark:text-khaki"
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </AdminTable>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className="min-h-touch rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-taupe disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-khaki"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="min-h-touch rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-taupe disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-khaki"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
      {resolving ? (
        <ResolveDialog
          title="Resolve payment review"
          actions={[
            { value: 'reject', label: 'Reject (cancel claim)' },
            { value: 'confirm_paid', label: 'Confirm paid' },
          ]}
          warning="Confirming paid marks the claim paid without re-checking the chain. This is an admin override — only use it when you have verified the payment another way. Rejecting cancels the claim; stock is returned unless the listing itself was disabled."
          submitLabel="Save decision"
          onClose={() => setResolving(null)}
          onSubmit={async ({ action, resolutionNotes }) => {
            await resolvePaymentReview(resolving.claim.id, {
              action: action as 'confirm_paid' | 'reject',
              resolutionNotes,
            });
            setNotice(
              action === 'confirm_paid'
                ? 'Claim marked paid by admin override.'
                : 'Claim cancelled; stock returned unless the listing was disabled.',
            );
            setResolving(null);
            load();
          }}
        />
      ) : null}
    </main>
  );
}
