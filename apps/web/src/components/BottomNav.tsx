// Floating pill bottom nav (D2): the single nav pattern at every width.
// Four items — Sell, Claims, Notifications, Profile — in a centered pill
// fixed above the safe area. Active item: a lime pill behind the icon +
// its label; inactive items are icon-only (four always-visible labels do
// not fit 320px). Unread: a numberless lime dot on the Notifications
// icon; the count lives on the notifications page. Active switching
// animates opacity + scale only (duration-ui, ease-out-strong) and
// collapses under prefers-reduced-motion via the global blanket.
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Package, Tag, User } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useNotifications } from '../store/notifications';

function isActive(pathname: string, key: string): boolean {
  switch (key) {
    case 'sell':
      // Sell list, new-slot form, and slot manage pages are one surface.
      return pathname === '/sell' || pathname.startsWith('/sell/');
    case 'claims':
      // The hold list and hold details are one surface.
      return pathname === '/claims' || pathname.startsWith('/claim/');
    case 'notifications':
      return pathname.startsWith('/notifications');
    case 'profile':
      return pathname.startsWith('/profile');
    default:
      return false;
  }
}

const ITEMS = [
  { key: 'sell', to: '/sell', label: 'Sell', Icon: Tag },
  { key: 'claims', to: '/claims', label: 'Claims', Icon: Package },
  { key: 'notifications', to: '/notifications', label: 'Notifications', Icon: Bell },
  { key: 'profile', to: '/profile', label: 'Profile', Icon: User },
] as const;

export default function BottomNav() {
  const pathname = useLocation().pathname;
  const authenticated = useAuth((s) => s.status === 'authenticated');
  const unread = useNotifications((s) => s.unread);
  const refreshUnread = useNotifications((s) => s.refresh);

  // Badge refresh trigger: re-read the unread count after every
  // navigation. No polling loop, no realtime channel ( scope).
  useEffect(() => {
    if (!authenticated) return;
    void refreshUnread();
  }, [pathname, authenticated, refreshUnread]);

  const count = unread ?? 0;

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]"
    >
      <div className="pointer-events-auto flex items-stretch gap-1 rounded-pill border border-border bg-surface px-2 py-2 shadow-card">
        {ITEMS.map(({ key, to, label, Icon }) => {
          const active = isActive(pathname, key);
          const showDot = key === 'notifications' && count > 0;
          return (
            <Link
              key={key}
              to={to}
              aria-current={active ? 'page' : undefined}
              aria-label={showDot ? `${label}, ${count} unread` : label}
              className="flex h-14 min-w-[52px] flex-col items-center justify-center gap-1 rounded-pill px-3 transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
            >
              <span
                aria-hidden="true"
                className={`relative flex items-center justify-center rounded-pill px-3 py-1 transition-[background-color,color,transform] duration-ui ease-out-strong motion-reduce:transition-none ${
                  active ? 'bg-accent text-accent-ink' : 'text-muted'
                }`}
              >
                <Icon size={24} />
                {showDot ? (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />
                ) : null}
              </span>
              {active ? (
                <span className="whitespace-nowrap font-sans text-small font-medium text-text">{label}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
