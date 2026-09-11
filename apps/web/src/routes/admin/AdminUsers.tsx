// Phase 10: /admin/users — people surfaced through reports (reporters and
// reported users), plus disabling by user id. There is no dedicated admin
// user directory endpoint in the locked API surface, so this page works from
// report data and direct ids only. Disabling revokes sessions immediately;
// it never touches listings or claims.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTable from '../../components/AdminTable';
import DisableDialog from '../../components/DisableDialog';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { ApiError } from '../../lib/api';
import { disableUser, fetchAdminReports } from '../../lib/admin';

interface ListedUser {
  id: string;
  walletDisplay: string;
  source: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [manualId, setManualId] = useState('');
  const [disabling, setDisabling] = useState<ListedUser | { id: string; walletDisplay: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchAdminReports({ limit: 50 })
      .then((res) => {
        const seen = new Map<string, ListedUser>();
        for (const r of res.reports) {
          if (!seen.has(r.reporter.id)) {
            seen.set(r.reporter.id, {
              id: r.reporter.id,
              walletDisplay: r.reporter.walletDisplay,
              source: 'reporter',
            });
          }
          if (r.targetUser && !seen.has(r.targetUser.id)) {
            seen.set(r.targetUser.id, {
              id: r.targetUser.id,
              walletDisplay: r.targetUser.walletDisplay,
              source: 'reported',
            });
          }
        }
        setUsers([...seen.values()]);
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

  const prefix = query.trim().toUpperCase();
  const visible = prefix
    ? users.filter((u) => u.walletDisplay.toUpperCase().startsWith(prefix))
    : users;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/admin" className="inline-block min-h-[44px] py-2 text-sm font-medium text-slate-600">
        ← Moderation
      </Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-slate-500">
        People seen in reports. Disabling signs them out everywhere; their listings and claims
        are left untouched.
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}
      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="user-search">
        Search by wallet prefix
      </label>
      <input
        id="user-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="NQ32…"
        className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton rows={2} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No users found"
            body="No reported or reporting users match. You can still disable an account by its id below."
          />
        ) : (
          <AdminTable label="Users seen in reports" headers={['User', 'Seen as', 'Action']}>
            {visible.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium">{u.walletDisplay}</td>
                <td className="px-3 py-2">{u.source}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setDisabling(u)}
                    className="min-h-[44px] rounded-lg border border-red-300 px-3 py-1 text-sm font-medium text-red-700"
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
        className="mt-6 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualId.trim()) {
            setDisabling({ id: manualId.trim(), walletDisplay: manualId.trim() });
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700" htmlFor="manual-user-id">
          Disable an account by id
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="manual-user-id"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="User id (uuid)"
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="min-h-[44px] shrink-0 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white"
          >
            Disable
          </button>
        </div>
      </form>
      {disabling ? (
        <DisableDialog
          title="Disable this account?"
          body={`Account ${disabling.walletDisplay} will be signed out everywhere and blocked from further actions. Listings and claims are left untouched. This cannot be undone here.`}
          submitLabel="Disable account"
          onClose={() => setDisabling(null)}
          onSubmit={async (reason) => {
            await disableUser(disabling.id, reason);
            setNotice('Account disabled and signed out everywhere.');
            setDisabling(null);
            setManualId('');
            load();
          }}
        />
      ) : null}
    </main>
  );
}
