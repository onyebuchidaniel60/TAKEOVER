// /Admin/slots — listings surfaced through reports and payment
// reviews, plus disabling by listing id. There is no dedicated admin listing
// directory endpoint in the locked API surface, so this page works from
// moderation data and direct ids only. Disabling cancels live holds, moves
// unclear payments to review, zeroes stock, and never touches paid claims.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTable from '../../components/AdminTable';
import DisableDialog from '../../components/DisableDialog';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { ApiError } from '../../lib/api';
import { usePageMeta } from '../../lib/meta';
import { disableSlot, fetchAdminReports, fetchPaymentReviews } from '../../lib/admin';

interface ListedSlot {
  id: string;
  title: string;
  status: string;
  source: string;
}

const FILTERS = ['', 'draft', 'published', 'sold_out', 'cancelled', 'open'] as const;

export default function AdminSlots() {
  usePageMeta({ title: 'Listings — TAKEOVER', robots: 'noindex' });
  const [slots, setSlots] = useState<ListedSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [manualId, setManualId] = useState('');
  const [disabling, setDisabling] = useState<ListedSlot | { id: string; title: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void Promise.all([fetchAdminReports({ limit: 50 }), fetchPaymentReviews({ limit: 50 })])
      .then(([reports, reviews]) => {
        const seen = new Map<string, ListedSlot>();
        for (const r of reports.reports) {
          if (r.slot && !seen.has(r.slot.id)) {
            seen.set(r.slot.id, { id: r.slot.id, title: r.slot.title, status: r.slot.status, source: 'report' });
          }
        }
        for (const review of reviews.reviews) {
          if (!seen.has(review.slot.id)) {
            seen.set(review.slot.id, {
              id: review.slot.id,
              title: review.slot.title,
              status: 'open',
              source: 'payment review',
            });
          }
        }
        setSlots([...seen.values()]);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter ? slots.filter((s) => s.status === filter) : slots;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/admin" className="inline-block min-h-touch py-2 text-body font-medium text-muted">
        ← Moderation
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-text">Listings</h1>
      <p className="mt-1 text-body text-muted">
        Openings seen in reports or payment reviews. Only draft or published listings can be
        disabled; paid claims are never touched.
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-surface-2 p-3 text-body text-accent">
          {notice}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-touch rounded-full px-4 py-2 text-body font-medium ${
              filter === f
                ? 'bg-accent text-accent-ink'
                : 'border border-border-strong bg-surface text-muted'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton rows={2} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No listings found"
            body="Nothing matches this filter. You can still disable a listing by its id below."
          />
        ) : (
          <AdminTable label="Listings seen in moderation" headers={['Listing', 'Status', 'Seen in', 'Action']}>
            {visible.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium">{s.title}</td>
                <td className="px-3 py-2">{s.status}</td>
                <td className="px-3 py-2">{s.source}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDisabling(s)}
                    className="min-h-touch rounded-lg border border-danger px-3 py-1 text-body font-medium text-danger bg-surface"
                  >
                    Disable
                  </button>
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
      </div>
      <form
        className="mt-6 rounded-xl border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualId.trim()) {
            setDisabling({ id: manualId.trim(), title: manualId.trim() });
          }
        }}
      >
        <label className="block text-body font-medium text-muted" htmlFor="manual-slot-id">
          Disable a listing by id
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="manual-slot-id"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Listing id (uuid)"
            autoComplete="off"
            spellCheck={false}
            className="min-h-touch flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-body text-text placeholder:text-muted placeholder:text-muted"
          />
          <button
            type="submit"
            className="min-h-touch shrink-0 rounded-lg bg-danger px-4 py-2 text-body font-medium text-accent-ink"
          >
            Disable
          </button>
        </div>
      </form>
      {disabling ? (
        <DisableDialog
          title="Disable this listing?"
          body={`“${disabling.title}” will be cancelled: live holds end, unclear payments move to review, and remaining stock goes to zero. Paid claims stay confirmed. This cannot be undone here.`}
          submitLabel="Disable listing"
          onClose={() => setDisabling(null)}
          onSubmit={async (reason) => {
            const result = await disableSlot(disabling.id, reason);
            setNotice(
              result.warning ??
                'Listing disabled. Live holds were cancelled and stock is now zero.',
            );
            setDisabling(null);
            setManualId('');
            load();
          }}
        />
      ) : null}
    </main>
  );
}
