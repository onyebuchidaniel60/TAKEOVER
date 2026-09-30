// Chrome identity chip (Phase 5k-B4).
//
// Three states, per D18:
//   guest        -> a small "Sign in" pill to /welcome
//   email user   -> 24px avatar + @username chip, to /profile
//   wallet user  -> 24px avatar + display name (or truncated wallet), to /profile
//
// The Log out action MOVED to the Profile header in 5k-B: three controls in
// a 56px header is too many at 320px, and signing out is a deliberate act
// that belongs on the page, not in the chrome.
import { Link } from 'react-router-dom';
import Avatar from './Avatar';
import { useAuth } from '../store/auth';
import { truncateWalletAddress } from '../lib/slots';

export default function WalletStatus() {
  const { status, user, error } = useAuth();

  if (status === 'authenticated' && user) {
    const name = user.providerProfile?.displayName
      ? user.providerProfile.displayName
      : (user.walletAddress
        ? truncateWalletAddress(user.walletAddress)
        : (user.username ? `@${user.username}` : 'Account'));
    return (
      <Link
        to="/profile"
        className="flex min-h-touch min-w-0 items-center gap-2 rounded-pill px-1.5 py-1 transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        title={name}
      >
        <Avatar data={user.avatarData ?? null} name={name} size={24} />
        <span className="min-w-0 max-w-32 truncate text-body font-medium text-accent">
          {name}
        </span>
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Link
        to="/welcome"
        className="inline-flex min-h-touch shrink-0 items-center rounded-pill bg-accent px-3 py-1.5 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97]"
      >
        {status === 'authenticating' ? 'Connecting…' : 'Sign in'}
      </Link>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
