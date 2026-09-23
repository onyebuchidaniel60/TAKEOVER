// Notifications page (top-level tab). Lifts NotificationsSection as-is:
// newest-first list, unread dots, "Mark all read", tap-to-read with
// navigation to the related claim or slot. Auth-guarded in App.tsx like
// the other account routes. Badge refresh stays route-change-driven
// (TopBar effect) — no polling loop.
import NotificationsSection from '../components/NotificationsSection';
import { usePageMeta } from '../lib/meta';

export default function NotificationsPage() {
  usePageMeta({ title: 'Notifications — TAKEOVER' });
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-h1 font-bold text-text">Notifications</h1>
      <div className="mt-4">
        <NotificationsSection />
      </div>
    </main>
  );
}
