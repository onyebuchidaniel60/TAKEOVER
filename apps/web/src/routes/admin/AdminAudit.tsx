// Phase 10: /admin/audit — immutable audit trail, newest first. Filters for
// event type, entity type, and date range; pagination below the table.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTable from '../../components/AdminTable';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { ApiError } from '../../lib/api';
import { usePageMeta } from '../../lib/meta';
import { fetchAuditEvents, type AuditEvent } from '../../lib/admin';

const PAGE_SIZE = 20;

export const KNOWN_EVENT_TYPES = [
  'user.created',
  'slot.published',
  'slot.cancelled',
  'claim.created',
  'payment.submitted',
  'payment.verified',
  'payment.review',
  'report.created',
  'report.resolved',
  'slot.disabled_by_admin',
  'user.disabled',
  'payment_review.resolved',
];

export default function AdminAudit() {
  usePageMeta({ title: 'Audit trail — TAKEOVER', robots: 'noindex' });
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [eventType, setEventType] = useState('');
  const [entityType, setEntityType] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchAuditEvents({
      eventType: eventType || undefined,
      entityType: entityType || undefined,
      since: since ? new Date(since).toISOString() : undefined,
      until: until ? new Date(until).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((res) => {
        setEvents(res.events);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
  }, [eventType, entityType, since, until, offset]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(event: React.FormEvent): void {
    event.preventDefault();
    setOffset(0);
    load();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/admin" className="inline-block min-h-touch py-2 text-body font-medium text-taupe dark:text-drift">
        ← Moderation
      </Link>
      <h1 className="mt-1 text-h1 font-bold text-bark dark:text-parchment">Audit trail</h1>
      <p className="mt-1 font-mono text-body tabular-nums text-muted dark:text-drift">
        {total} event{total === 1 ? '' : 's'} · newest first
      </p>
      <form
        onSubmit={applyFilters}
        className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa sm:grid-cols-2"
      >
        <div>
          <label className="block text-body font-medium text-taupe dark:text-khaki" htmlFor="audit-event-type">
            Event type
          </label>
          <input
            id="audit-event-type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="e.g. payment.verified"
            autoComplete="off"
            list="audit-event-types"
            className="mt-1 min-h-touch w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 font-mono text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
          />
          <datalist id="audit-event-types">
            {KNOWN_EVENT_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-body font-medium text-taupe dark:text-khaki" htmlFor="audit-entity-type">
            Entity type
          </label>
          <input
            id="audit-entity-type"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. claim"
            autoComplete="off"
            className="mt-1 min-h-touch w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 font-mono text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
          />
        </div>
        <div>
          <label className="block text-body font-medium text-taupe dark:text-khaki" htmlFor="audit-since">
            Since
          </label>
          <input
            id="audit-since"
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="mt-1 min-h-touch w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 font-mono text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
          />
        </div>
        <div>
          <label className="block text-body font-medium text-taupe dark:text-khaki" htmlFor="audit-until">
            Until
          </label>
          <input
            id="audit-until"
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="mt-1 min-h-touch w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 font-mono text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="min-h-touch w-full rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory dark:bg-sandlight dark:text-coal"
          >
            Apply filters
          </button>
        </div>
      </form>
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : events.length === 0 ? (
          <EmptyState title="No events" body="Nothing matches these filters." />
        ) : (
          <>
            <AdminTable
              label="Audit events"
              headers={['When', 'Event', 'Actor', 'Details']}
            >
              {events.map((e) => (
                <tr key={e.id} className="border-b border-hairline last:border-0 dark:border-rootline">
                  <td className="px-3 py-2 align-top font-mono text-small tabular-nums text-muted dark:text-drift">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p className="font-mono font-medium">{e.event_type}</p>
                    <p className="font-mono text-small text-muted dark:text-drift">
                      {e.entity_type} · {e.entity_id.slice(0, 8)}…
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top font-mono">{e.actor?.walletDisplay ?? '—'}</td>
                  <td className="px-3 py-2 align-top text-small">
                    <details>
                      <summary className="inline-flex min-h-touch cursor-pointer items-center text-taupe dark:text-drift">
                        Details
                      </summary>
                      <pre className="mt-1 max-w-56 overflow-x-auto whitespace-pre-wrap break-all font-mono text-small text-taupe dark:text-drift">
                        {JSON.stringify(e.metadata ?? {}, null, 2)}
                      </pre>
                    </details>
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
    </main>
  );
}
