// Notifications section (top-level Notifications page since
// the nav-tab move). Own fetch (loading/error states local to the
// section); newest first; unread rows carry a dot; tapping a row marks
// it read and navigates to the related claim or slot.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationView,
} from '../lib/slots';
import { queryKeys } from '../lib/queryKeys';

/** Where a tap goes: providers review their slot, buyers open their claim. */
export function notificationTarget(n: NotificationView): string {
  if (n.entity_type === 'slot') {
    return `/sell/${n.entity_id}`;
  }
  return `/claim/${n.entity_id}`;
}

export default function NotificationsSection() {
  const queryClient = useQueryClient();
  const [markingAll, setMarkingAll] = useState(false);

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchNotifications,
  });
  // Defensive preserved: a malformed payload renders the empty state,
  // never crashes the Notifications page.
  const raw = notificationsQuery.data?.notifications;
  const items: NotificationView[] = Array.isArray(raw) ? raw : [];
  const loading = notificationsQuery.isPending;
  const queryError = notificationsQuery.error;
  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'Something went wrong.'
    : null;

  // Read mutations update the shared cache optimistically (instant dot
  // clearing, including the nav badge) and confirm against the server;
  // failures roll back to the last server state.
  const touchRead = (id: string | null): void => {
    const now = new Date().toISOString();
    queryClient.setQueryData(
      queryKeys.notifications,
      (prev: { notifications: NotificationView[]; unreadCount: number } | undefined) => {
        if (!prev || !Array.isArray(prev.notifications)) return prev;
        const notifications =
          id === null
            ? prev.notifications.map((n) => (n.read_at ? n : { ...n, read_at: now }))
            : prev.notifications.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n));
        return { ...prev, notifications, unreadCount: notifications.filter((n) => !n.read_at).length };
      },
    );
  };

  const readMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id: string) => touchRead(id),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: () => touchRead(null),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      setMarkingAll(false);
    },
  });

  const handleOpen = (item: NotificationView): void => {
    if (!item.read_at) {
      // Fire-and-forget: the Link navigates immediately; the optimistic
      // cache update clears the dot and the badge at once.
      readMutation.mutate(item.id);
    }
  };

  const handleMarkAll = (): void => {
    setMarkingAll(true);
    readAllMutation.mutate();
  };

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Notifications">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small font-medium uppercase tracking-wide text-muted">Notifications</p>
        {unreadCount > 0 && !loading && !error ? (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={markingAll}
            className="min-h-touch rounded-lg border border-border-strong bg-surface px-3 py-1 text-body font-medium text-muted disabled:opacity-50"
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        ) : null}
      </div>
      <div className="mt-3" aria-live="polite">
        {loading ? (
          <p className="text-body text-muted">Loading notifications…</p>
        ) : error ? (
          <div>
            <p className="text-body text-muted">{error}</p>
            <button
              type="button"
              onClick={() => void notificationsQuery.refetch()}
              className="mt-2 min-h-touch rounded-lg border border-border-strong px-3 py-1 text-body font-medium text-muted bg-surface"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-body text-muted">You’re all caught up — new funding and delivery updates land here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={notificationTarget(item)}
                  onClick={() => handleOpen(item)}
                  className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-[box-shadow,transform] duration-ui ease-out-strong hover:shadow-card active:scale-[0.99]"
                  aria-label={`${item.title}${item.read_at ? '' : ', unread'}`}
                >
                  {!item.read_at ? (
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  ) : null}
                  <span>
                    <span className={`block text-body ${item.read_at ? 'font-normal text-muted' : 'font-semibold text-text'}`}>
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-body text-muted">{item.body}</span>
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
