// Phase 9: real profile page (replaces the Phase 3 debug placeholder).
// Wallet, role, provider display-name setup/edit, links, logout. No wallet
// SDK usage here — display and form state only, server stays authoritative.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import NotificationsSection from '../components/NotificationsSection';
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
import { useTheme, type ThemeMode } from '../store/theme';

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
      <h1 className="text-h1 font-bold text-slate-900 dark:text-stone-100">Profile</h1>
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
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-label="Wallet">
            <p className="text-small font-medium uppercase tracking-wide text-slate-500 dark:text-stone-400">Wallet</p>
            <button
              type="button"
              onClick={handleCopy}
              title={user.walletAddress}
              className="mt-1 min-h-touch rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-body text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus-visible:ring-stone-200"
            >
              {truncateWalletAddress(user.walletAddress)}
              <span className="ml-2 font-sans text-small text-slate-500 dark:text-stone-400">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <p className="mt-2 text-body text-slate-600 dark:text-stone-400">
              Role: <span className="font-medium capitalize">{user.role}</span>
            </p>
          </section>

          <ThemeSection />

          <ProviderSection
            user={user}
            hasSlots={hasSlots}
            onSaved={(displayName) =>
              setUser({ ...user, providerProfile: { displayName }, hasProviderProfile: true })
            }
          />

          <NotificationsSection />

          <section className="flex flex-wrap gap-2" aria-label="Shortcuts">
            <Link
              to="/sell"
              className="inline-block min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-body font-medium text-white dark:bg-stone-100 dark:text-stone-900"
            >
              My openings
            </Link>
            <Link
              to="/claims"
              className="inline-block min-h-touch rounded-lg border border-slate-300 bg-white px-4 py-2 text-body font-medium text-slate-700 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
            >
              My holds
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-touch rounded-lg border border-slate-300 bg-white px-4 py-2 text-body font-medium text-slate-700 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
            >
              Log out
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

// Phase 14l-3: appearance toggle (Light / Dark / Auto). Auto follows the
// OS; a manual choice is remembered across reloads by the theme store. Plain
// text segments — the icon budget stays at 10/10.
const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

function ThemeSection() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
      aria-label="Appearance"
    >
      <p className="text-small font-medium uppercase tracking-wide text-slate-500 dark:text-stone-400">
        Appearance
      </p>
      <div className="mt-2 flex gap-2" role="group" aria-label="Color theme">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setMode(option.value)}
            aria-pressed={mode === option.value}
            className={`min-h-touch rounded-full px-4 py-2 text-body font-medium ${
              mode === option.value
                ? 'bg-slate-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'border border-slate-300 bg-white text-slate-700 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-small text-slate-500 dark:text-stone-400">
        Auto follows your device setting.
      </p>
    </section>
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
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-label="Provider">
        <p className="text-small font-medium uppercase tracking-wide text-slate-500 dark:text-stone-400">Provider</p>
        <p className="mt-1 text-h3 font-semibold text-slate-900 dark:text-stone-100">{existing}</p>
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
                className="inline-block min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-body font-medium text-white dark:bg-stone-100 dark:text-stone-900"
          >
            Create your first slot
          </Link>
        }
      />
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" aria-label="Provider">
      <p className="text-small font-medium uppercase tracking-wide text-slate-500 dark:text-stone-400">Provider</p>
      <p className="mt-1 text-body text-slate-600 dark:text-stone-400">
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
    // Phase 14c round 3 (Fix C1): validate against the server rules before
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
      <label htmlFor="provider-display-name" className="text-body font-medium text-slate-700 dark:text-stone-300">
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
        className="mt-1 block min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-body text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus-visible:ring-stone-200"
      />
      {error ? (
        <p className="mt-2 text-body font-medium text-red-800 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="mt-2 min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-body font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
