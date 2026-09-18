import { LogOut, Wallet } from 'lucide-react';
import { useAuth } from '../store/auth';

function truncate(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletStatus() {
  const { status, user, error, login, logout } = useAuth();

  if (status === 'authenticated' && user) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="max-w-44 truncate rounded-full bg-emerald-100 px-3 py-1 text-body font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          title={user.walletAddress}
        >
          {truncate(user.walletAddress)}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-body font-medium text-slate-700 transition-transform duration-press ease-out-strong active:scale-[0.97] dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
        >
          <LogOut size={14} aria-hidden="true" />
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void login()}
        disabled={status === 'authenticating'}
        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-body font-semibold text-white transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900"
      >
        <Wallet size={16} aria-hidden="true" />
        {status === 'authenticating' ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-small text-red-800 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
