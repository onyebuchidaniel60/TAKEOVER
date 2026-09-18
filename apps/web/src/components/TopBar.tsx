import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isAdminUser } from '../lib/admin';
import { useAuth } from '../store/auth';
import { useNotifications } from '../store/notifications';
import BrandMark from './BrandMark';
import WalletStatus from './WalletStatus';

export default function TopBar() {
  const user = useAuth((s) => s.user);
  const authenticated = useAuth((s) => s.status === 'authenticated');
  const unread = useNotifications((s) => s.unread);
  const refreshUnread = useNotifications((s) => s.refresh);
  const pathname = useLocation().pathname;

  // Badge refresh trigger: re-read the unread count after every navigation.
  // No polling loop, no realtime channel (14l-2 scope).
  useEffect(() => {
    if (!authenticated) return;
    void refreshUnread();
  }, [pathname, authenticated, refreshUnread]);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Primary">
          <Link
            to="/"
            aria-label="TAKEOVER home"
            className="inline-flex min-h-touch items-center gap-2 text-lg font-bold tracking-[-0.02em] text-slate-900"
          >
            <BrandMark size={24} />
            TAKEOVER
          </Link>
          <Link to="/sell" className="inline-flex min-h-touch items-center text-sm text-slate-600">
            Sell
          </Link>
          <Link to="/claims" className="inline-flex min-h-touch items-center text-sm text-slate-600">
            Claims
          </Link>
          <Link
            to="/profile"
            className="inline-flex min-h-touch items-center gap-1.5 text-sm text-slate-600"
            aria-label={unread ? `Profile, ${unread} unread notifications` : 'Profile'}
          >
            Profile
            {unread ? (
              <span
                aria-hidden="true"
                className="inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold tabular-nums text-white"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </Link>
          {isAdminUser(user) ? (
            <Link
              to="/admin"
              className="inline-flex min-h-touch items-center text-sm font-medium text-slate-900"
            >
              Admin
            </Link>
          ) : null}
        </nav>
        <WalletStatus />
      </div>
    </header>
  );
}
