// Phase 10: /admin/reports — newest first, optional status filter,
// resolve dialog per row. Resolving records the outcome only; it takes no
// automatic further action.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTable from '../../components/AdminTable';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import ResolveDialog from '../../components/ResolveDialog';
import { ApiError } from '../../lib/api';
import { usePageMeta } from '../../lib/meta';
import { fetchAdminReports, resolveReport, type AdminReport } from '../../lib/admin';

const PAGE_SIZE = 20;
const FILTERS = ['', 'open', 'reviewed', 'dismissed'] as const;

export default function AdminReports() {
  usePageMeta({ title: 'Reports — TAKEOVER', robots: 'noindex' });
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('open');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<AdminReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchAdminReports({ status: status || undefined, limit: PAGE_SIZE, offset })
      .then((res) => {
        setReports(res.reports);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
  }, [status, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/admin" className="inline-block min-h-touch py-2 text-body font-medium text-slate-600 dark:text-stone-400">
        ← Moderation
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-slate-900 dark:text-stone-100">Reports</h1>
      <p className="mt-1 font-mono text-body tabular-nums text-slate-500 dark:text-stone-400">
        {total} report{total === 1 ? '' : 's'} · newest first
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-body text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => {
              setStatus(f);
              setOffset(0);
            }}
            aria-pressed={status === f}
            className={`min-h-touch rounded-full px-4 py-2 text-body font-medium ${
              status === f
                ? 'bg-slate-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'border border-slate-300 bg-white text-slate-700 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300'
            }`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : reports.length === 0 ? (
          <EmptyState title="No reports" body="Nothing matches this filter right now." />
        ) : (
          <>
            <AdminTable
              label="Abuse reports"
              headers={['Report', 'Target', 'Reason', 'Status', 'Action']}
            >
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-stone-800">
                  <td className="px-3 py-2 align-top">
                    <p className="font-mono font-medium">{r.reporter.walletDisplay}</p>
                    <p className="font-mono text-small tabular-nums text-slate-500 dark:text-stone-400">{new Date(r.created_at).toLocaleString()}</p>
                    {r.details ? <p className="mt-1 text-small text-slate-600 dark:text-stone-400">{r.details}</p> : null}
                    {r.resolution_notes ? (
                      <p className="mt-1 text-small text-slate-500 dark:text-stone-400">Note: {r.resolution_notes}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-small">
                    {r.slot ? (
                      <p>
                        Listing: {r.slot.title} ({r.slot.status})
                      </p>
                    ) : null}
                    {r.targetUser ? <p className="font-mono">User: {r.targetUser.walletDisplay}</p> : null}
                  </td>
                  <td className="px-3 py-2 align-top">{r.reason}</td>
                  <td className="px-3 py-2 align-top">{r.status}</td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setResolving(r)}
                      className="min-h-touch rounded-lg border border-slate-300 px-3 py-1 text-body font-medium text-slate-700 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
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
                className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-body font-medium text-slate-700 disabled:opacity-50 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-body font-medium text-slate-700 disabled:opacity-50 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
      {resolving ? (
        <ResolveDialog
          title="Resolve report"
          actions={[
            { value: 'reviewed', label: 'Reviewed' },
            { value: 'dismissed', label: 'Dismissed' },
          ]}
          submitLabel="Save resolution"
          onClose={() => setResolving(null)}
          onSubmit={async ({ action, resolutionNotes }) => {
            await resolveReport(resolving.id, {
              action: action as 'reviewed' | 'dismissed',
              resolutionNotes,
            });
            setNotice(`Report marked ${action}. No automatic action was taken.`);
            setResolving(null);
            load();
          }}
        />
      ) : null}
    </main>
  );
}
