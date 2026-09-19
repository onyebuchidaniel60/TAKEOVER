import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { isAdminUser } from '../lib/admin';
import { useAuth } from '../store/auth';
import { useNotifications } from '../store/notifications';
import BrandMark from './BrandMark';
import NavDrawer from './NavDrawer';
import WalletStatus from './WalletStatus';

export default function TopBar() {
  const user = useAuth((s) => s.user);
  const authenticated = useAuth((s) => s.status === 'authenticated');
  const unread = useNotifications((s) => s.unread);
  const refreshUnread = useNotifications((s) => s.refresh);
  const pathname = useLocation().pathname;
  const [menuOpen, setMenuOpen] = useState(false);

  // Badge refresh trigger: re-read the unread count after every navigation.
  // No polling loop, no realtime channel (14l-2 scope).
  useEffect(() => {
    if (!authenticated) return;
    void refreshUnread();
  }, [pathname, authenticated, refreshUnread]);

  // The drawer is route-scoped chrome: any navigation dismisses it.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const count = unread ?? 0;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-hairline/80 bg-cream/80 backdrop-blur-md dark:border-rootline dark:bg-coal/80">
        <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <Link
              to="/"
              aria-label="TAKEOVER home"
              className="inline-flex min-h-touch items-center gap-2 text-h3 font-bold text-bark dark:text-parchment"
            >
              <BrandMark size={24} />
              TAKEOVER
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="site-nav"
              aria-label={count > 0 ? `Open menu, ${count} unread notifications` : 'Open menu'}
              className="relative inline-flex min-h-touch items-center gap-2 rounded-lg border border-borderwarm bg-cream px-3 py-1 text-body font-medium text-taupe transition-transform duration-press ease-out-strong active:scale-[0.97] dark:border-rootedge dark:bg-cocoa dark:text-khaki"
            >
              <Menu size={18} aria-hidden="true" />
              Menu
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-cream bg-terra dark:border-cocoa dark:bg-terralight"
                />
              ) : null}
            </button>
          </div>
          <WalletStatus />
        </div>
      </header>
      {/*
        The drawer lives OUTSIDE the header on purpose: the header's
        backdrop-blur makes it the containing block for fixed
        descendants, so a fixed drawer rendered inside it would size to
        the header strip instead of the viewport (transparent-looking
        panel, no page scrim). Keep it a sibling.
      */}
      <NavDrawer
        open={menuOpen}
        unread={unread}
        isAdmin={isAdminUser(user)}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
