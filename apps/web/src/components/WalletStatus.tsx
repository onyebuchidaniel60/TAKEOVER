import { useAuth } from '../store/auth';

function truncate(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletStatus() {
  const { status, user, error, login, logout } = useAuth();

  if (status === 'authenticated' && user) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900"
          title={user.walletAddress}
        >
          {truncate(user.walletAddress)}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="min-h-touch rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700"
        >
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
        className="min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {status === 'authenticating' ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
