// Phase 9: real profile page (replaces the Phase 3 debug placeholder).
// Wallet, role, provider display-name setup/edit, links, logout. No wallet
// SDK usage here — display and form state only, server stays authoritative.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import {
  fetchMe,
  fetchMySlots,
  truncateWalletAddress,
  updateProviderProfile,
  type MeUser,
} from '../lib/slots';
import { useAuth } from '../store/auth';

export default function Profile() {
  const logout = useAuth((s) => s.logout);
  const [user, setUser] = useState<MeUser | null>(null);
  const [hasSlots, setHasSlots] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([fetchMe(), fetchMySlots({ limit: 1 })])
      .then(([me, mine]) => {
        if (cancelled) return;
        setUser(me.user);
        setHasSlots(mine.total > 0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const handleCopy = (): void => {
    if (!user) return;
    const full = user.walletAddress;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(full)
        .then(() => setCopied(true))
        .catch(() => setCopied(false));
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
      {loading ? (
        <div className="mt-4">
          <LoadingSkeleton rows={2} />
        </div>
      ) : error || !user ? (
        <div className="mt-4">
          <ErrorState message={error ?? 'Something went wrong.'} onRetry={() => setRetryKey((k) => k + 1)} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Wallet">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallet</p>
            <button
              type="button"
              onClick={handleCopy}
              title={user.walletAddress}
              className="mt-1 min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              {truncateWalletAddress(user.walletAddress)}
              <span className="ml-2 text-xs text-slate-500">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <p className="mt-2 text-sm text-slate-600">
              Role: <span className="font-medium capitalize">{user.role}</span>
            </p>
          </section>

          <ProviderSection
            user={user}
            hasSlots={hasSlots}
            onSaved={(displayName) =>
              setUser({ ...user, providerProfile: { displayName }, hasProviderProfile: true })
            }
          />

          <section className="flex flex-wrap gap-2" aria-label="Shortcuts">
            <Link
              to="/sell"
              className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              My openings
            </Link>
            <Link
              to="/claims"
              className="inline-block min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              My holds
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              Log out
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function ProviderSection({
  user,
  hasSlots,
  onSaved,
}: {
  user: MeUser;
  hasSlots: boolean;
  onSaved: (displayName: string) => void;
}) {
  const existing = user.providerProfile?.displayName ?? null;
  if (existing) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Provider">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Provider</p>
        <p className="mt-1 text-lg font-semibold">{existing}</p>
        <DisplayNameForm initial="" submitLabel="Change display name" onSaved={onSaved} />
      </section>
    );
  }
  if (!hasSlots) {
    return (
      <EmptyState
        title="Become a provider"
        body="Publish an opening to start selling released capacity."
        action={
          <Link
            to="/sell/new"
            className="inline-block min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Create your first slot
          </Link>
        }
      />
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Provider">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Provider</p>
      <p className="mt-1 text-sm text-slate-600">
        Name your openings — buyers see this instead of your wallet.
      </p>
      <DisplayNameForm initial="" submitLabel="Set display name" onSaved={onSaved} />
    </section>
  );
}

function DisplayNameForm({
  initial,
  submitLabel,
  onSaved,
}: {
  initial: string;
  submitLabel: string;
  onSaved: (displayName: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    void updateProviderProfile(value)
      .then(({ providerProfile }) => {
        onSaved(providerProfile.displayName);
        setValue('');
        setSaving(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSaving(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <label htmlFor="provider-display-name" className="text-sm font-medium text-slate-700">
        Display name
      </label>
      <input
        id="provider-display-name"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={60}
        placeholder="e.g. Sunrise Yoga"
        className="mt-1 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      />
      {error ? (
        <p className="mt-2 text-sm font-medium text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="mt-2 min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
