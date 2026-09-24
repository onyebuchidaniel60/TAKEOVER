// Real profile page (replaces the debug placeholder).
// Wallet, provider display-name setup/edit, links, logout. No wallet
// SDK usage here — display and form state only, server stays authoritative.
// No role display (Phase 4b): any user can buy or provide, so the label
// is meaningless — the fetch stays, only the visible line is gone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import {
  fetchMe,
  fetchMySlots,
  truncateWalletAddress,
  updateProviderProfile,
  validateDisplayName,
  type MeUser,
} from '../lib/slots';
import { useAuth } from '../store/auth';

export default function Profile() {
  usePageMeta({ title: 'Profile — TAKEOVER' });
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
      <h1 className="text-h1 font-bold text-text">Profile</h1>
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
          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Wallet">
            <p className="text-small font-medium uppercase tracking-wide text-muted">Wallet</p>
            <button
              type="button"
              onClick={handleCopy}
              title={user.walletAddress}
              className="mt-1 min-h-touch rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-body text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-accent"
            >
              {truncateWalletAddress(user.walletAddress)}
              <span className="ml-2 font-sans text-small text-muted">{copied ? 'Copied' : 'Copy'}</span>
            </button>
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
              className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
            >
              My openings
            </Link>
            <Link
              to="/claims"
              className="inline-block min-h-touch rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted"
            >
              My holds
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-touch rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted"
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
      <section className="rounded-xl border border-border bg-surface p-4" aria-label="Provider">
        <p className="text-small font-medium uppercase tracking-wide text-muted">Provider</p>
        <p className="mt-1 text-h3 font-semibold text-text">{existing}</p>
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
                className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
          >
            Create your first slot
          </Link>
        }
      />
    );
  }
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Provider">
      <p className="text-small font-medium uppercase tracking-wide text-muted">Provider</p>
      <p className="mt-1 text-body text-muted">
        Name your openings — buyers see this instead of your wallet.
      </p>
      <DisplayNameForm initial="" submitLabel="Set display name" onSaved={onSaved} />
    </section>
  );
}

export function DisplayNameForm({
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
    // Validate against the server rules before
    // sending, so rejections surface inline instead of as a failed request.
    // The server stays authoritative for anything that still slips through.
    const reason = validateDisplayName(value);
    if (reason) {
      setError(reason);
      return;
    }
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
      <label htmlFor="provider-display-name" className="text-body font-medium text-muted">
        Display name
      </label>
      <input
        id="provider-display-name"
        type="text"
        autoComplete="nickname"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={60}
        placeholder="e.g. Sunrise Yoga"
        className="mt-1 block min-h-touch w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-muted focus-visible:ring-accent"
      />
      {error ? (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="mt-2 min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
