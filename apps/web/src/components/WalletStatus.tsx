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
          className="max-w-44 truncate rounded-full bg-sagewash px-3 py-1 text-body font-medium text-sage dark:bg-sagewashd dark:text-saged"
          title={user.walletAddress}
        >
          {truncate(user.walletAddress)}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-lg border border-borderwarm bg-cream px-3 py-1 text-body font-medium text-taupe transition-transform duration-press ease-out-strong active:scale-[0.97] dark:border-rootedge dark:bg-cocoa dark:text-khaki"
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
        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-terra px-4 py-2 text-body font-semibold text-ivory transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:opacity-60 dark:bg-sandlight dark:text-coal"
      >
        <Wallet size={16} aria-hidden="true" />
        {status === 'authenticating' ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-small text-clay dark:text-clayd">
          {error}
        </p>
      ) : null}
    </div>
  );
}
