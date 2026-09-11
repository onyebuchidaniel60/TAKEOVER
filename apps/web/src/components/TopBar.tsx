import { Link } from 'react-router-dom';
import { isAdminUser } from '../lib/admin';
import { useAuth } from '../store/auth';
import WalletStatus from './WalletStatus';

export default function TopBar() {
  const user = useAuth((s) => s.user);
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <nav className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold tracking-tight">
            TAKEOVER
          </Link>
          <Link to="/sell" className="text-sm text-slate-600">
            Sell
          </Link>
          <Link to="/claims" className="text-sm text-slate-600">
            Claims
          </Link>
          <Link to="/profile" className="text-sm text-slate-600">
            Profile
          </Link>
          {isAdminUser(user) ? (
            <Link to="/admin" className="text-sm font-medium text-slate-900">
              Admin
            </Link>
          ) : null}
        </nav>
        <WalletStatus />
      </div>
    </header>
  );
}
