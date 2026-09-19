// Hamburger navigation drawer: the single nav pattern at every width.
// The top bar holds only the brand lockup + menu button (left) and the
// wallet element (right); Sell / Claims / Notifications / Profile live
// here. Motion follows the drawer token (ease-drawer, panel 280ms —
// under the 300ms UI budget), transform + opacity only, and collapses
// to an instant show/hide under prefers-reduced-motion (plus the global
// reduced-motion blanket in index.css). Accessibility reuses the
// dialog-focus discipline (focus trap, Escape close, focus return to
// the hamburger) with a nav landmark instead of a dialog role.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../lib/dialog-focus';

// Keep mounted 200ms after close so the slide-out can play (matches
// duration-ui; the panel itself runs duration-panel 280ms).
const EXIT_MS = 200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function NavDrawer({
  open,
  unread,
  isAdmin,
  onClose,
}: {
  open: boolean;
  unread: number | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useDialogFocus<HTMLElement>(mounted, onClose);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (prefersReducedMotion()) {
        setVisible(true);
        return;
      }
      const frame = requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!mounted) {
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      setVisible(false);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) {
    return null;
  }

  const count = unread ?? 0;
  const linkClass =
    'flex min-h-touch items-center justify-between gap-2 rounded-lg px-3 text-body text-taupe hover:bg-sand dark:text-drift dark:hover:bg-umber';

  return (
    <div className="fixed inset-0 z-50">
      <div
        data-testid="nav-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-coal/60 transition-opacity duration-ui ease-out-strong motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <nav
        ref={panelRef}
        id="site-nav"
        aria-label="Site menu"
        className={`absolute bottom-0 left-0 top-0 w-[280px] max-w-[85vw] bg-cream shadow-card transition-transform duration-panel ease-drawer motion-reduce:transition-none dark:bg-cocoa ${
          visible ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline/80 px-3 py-2 dark:border-rootline">
          <span className="px-1 text-h3 font-bold text-bark dark:text-parchment">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex min-h-touch min-w-[44px] items-center justify-center rounded-lg border border-borderwarm bg-cream px-3 py-1 text-body font-medium text-taupe transition-transform duration-press ease-out-strong active:scale-[0.97] dark:border-rootedge dark:bg-cocoa dark:text-khaki"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="flex flex-col gap-1 p-3">
          <li>
            <Link to="/sell" onClick={onClose} className={linkClass}>
              Sell
            </Link>
          </li>
          <li>
            <Link to="/claims" onClick={onClose} className={linkClass}>
              Claims
            </Link>
          </li>
          <li>
            <Link
              to="/notifications"
              onClick={onClose}
              className={linkClass}
              aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
            >
              <span>Notifications</span>
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-terra px-1 font-mono text-small font-bold tabular-nums text-ivory"
                >
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </Link>
          </li>
          <li>
            <Link to="/profile" onClick={onClose} className={linkClass}>
              Profile
            </Link>
          </li>
          {isAdmin ? (
            <li>
              <Link
                to="/admin"
                onClick={onClose}
                className="flex min-h-touch items-center justify-between gap-2 rounded-lg px-3 text-body font-medium text-bark dark:text-parchment"
              >
                Admin
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
