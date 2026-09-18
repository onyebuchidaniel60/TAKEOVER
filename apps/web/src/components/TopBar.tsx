import { Link } from 'react-router-dom';
import { isAdminUser } from '../lib/admin';
import { useAuth } from '../store/auth';
import WalletStatus from './WalletStatus';

export default function TopBar() {
  const user = useAuth((s) => s.user);
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Primary">
          <Link to="/" className="inline-flex min-h-touch items-center text-lg font-bold tracking-tight">
            TAKEOVER
          </Link>
          <Link to="/sell" className="inline-flex min-h-touch items-center text-sm text-slate-600">
            Sell
          </Link>
          <Link to="/claims" className="inline-flex min-h-touch items-center text-sm text-slate-600">
            Claims
          </Link>
          <Link to="/profile" className="inline-flex min-h-touch items-center text-sm text-slate-600">
            Profile
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
