// Notifications section (top-level Notifications page since
// the nav-tab move). Own fetch (loading/error states local to the
// section); newest first; unread rows carry a dot; tapping a row marks
// it read and navigates to the related claim or slot.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationView,
} from '../lib/slots';
import { useNotifications } from '../store/notifications';

/** Where a tap goes: providers review their slot, buyers open their claim. */
export function notificationTarget(n: NotificationView): string {
  if (n.entity_type === 'slot') {
    return `/sell/${n.entity_id}`;
  }
  return `/claim/${n.entity_id}`;
}

export default function NotificationsSection() {
  const refreshBadge = useNotifications((s) => s.refresh);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchNotifications()
      .then((res) => {
        if (cancelled) return;
        // Defensive: a malformed payload must render the empty state,
        // never crash the Notifications page.
        setItems(Array.isArray(res.notifications) ? res.notifications : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const handleOpen = (item: NotificationView): void => {
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      // Fire-and-forget: the Link navigates immediately; the badge refreshes
      // from the response (or the next route change refreshes it anyway).
      void markNotificationRead(item.id)
        .then(() => refreshBadge())
        .catch(() => refreshBadge());
    }
  };

  const handleMarkAll = (): void => {
    setMarkingAll(true);
    void markAllNotificationsRead()
      .then(() => {
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
        return refreshBadge();
      })
      .catch(() => refreshBadge())
      .finally(() => setMarkingAll(false));
  };

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <section className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa" aria-label="Notifications">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small font-medium uppercase tracking-wide text-muted dark:text-drift">Notifications</p>
        {unreadCount > 0 && !loading && !error ? (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={markingAll}
            className="min-h-touch rounded-lg border border-borderwarm bg-cream px-3 py-1 text-body font-medium text-taupe disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-khaki"
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        ) : null}
      </div>
      <div className="mt-3" aria-live="polite">
        {loading ? (
          <p className="text-body text-muted dark:text-drift">Loading notifications…</p>
        ) : error ? (
          <div>
            <p className="text-body text-taupe dark:text-drift">{error}</p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="mt-2 min-h-touch rounded-lg border border-borderwarm px-3 py-1 text-body font-medium text-taupe dark:border-rootedge dark:bg-cocoa dark:text-khaki"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-body text-muted dark:text-drift">You’re all caught up — new funding and delivery updates land here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={notificationTarget(item)}
                  onClick={() => handleOpen(item)}
                  className="flex items-start gap-2 rounded-lg border border-hairline bg-cream p-3 text-left transition-[box-shadow,transform] duration-ui ease-out-strong hover:shadow-card active:scale-[0.99] dark:border-rootline dark:bg-cocoa dark:hover:shadow-none"
                  aria-label={`${item.title}${item.read_at ? '' : ', unread'}`}
                >
                  {!item.read_at ? (
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-terra" />
                  ) : null}
                  <span>
                    <span className={`block text-body ${item.read_at ? 'font-normal text-taupe dark:text-drift' : 'font-semibold text-bark dark:text-parchment'}`}>
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-body text-taupe dark:text-drift">{item.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
