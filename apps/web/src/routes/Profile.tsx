// Real profile page (replaces the debug placeholder).
// Wallet, provider display-name setup/edit, links, logout. No wallet
// SDK usage here — display and form state only, server stays authoritative.
// No role display (Phase 4b): any user can buy or provide, so the label
// is meaningless — the fetch stays, only the visible line is gone.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { ApiError } from '../lib/api';
import { prepareImage } from '../lib/image';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import {
  fetchMe,
  fetchMySlots,
  truncateWalletAddress,
  updateMeAvatar,
  updateProviderProfile,
  validateDisplayName,
  type MeUser,
} from '../lib/slots';
import { useAuth } from '../store/auth';

export default function Profile() {
  usePageMeta({ title: 'Profile — TAKEOVER' });
  const logout = useAuth((s) => s.logout);
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  // The ['me'] entry is usually pre-seeded by the App refresh; the
  // existence probe stays its own tiny query.
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  const slotsQuery = useQuery({
    queryKey: queryKeys.mySlots('profile-check'),
    queryFn: () => fetchMySlots({ limit: 1 }),
  });
  const user: MeUser | null = meQuery.data?.user ?? null;
  const hasSlots = (slotsQuery.data?.total ?? 0) > 0;
  const loading = meQuery.isPending || slotsQuery.isPending;
  const firstError = meQuery.error ?? slotsQuery.error;
  const error = firstError
    ? firstError instanceof ApiError
      ? firstError.message
      : 'Something went wrong.'
    : null;

  const setUser = (next: MeUser | null): void => {
    if (next) queryClient.setQueryData(queryKeys.me, { user: next });
  };

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
          <ErrorState
            message={error ?? 'Something went wrong.'}
            onRetry={() => {
              void meQuery.refetch();
              void slotsQuery.refetch();
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <AvatarSection user={user} />

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

// Profile picture (Phase 5d): 48px preview next to the display name,
// file picker on click, client-side resize to ≤200KB before upload.
// Success refreshes ['me'] plus every slot-scoped cache (feed cards and
// detail pages render the provider avatar from slot projections).
function AvatarSection({ user }: { user: MeUser }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatar = user.avatarData ?? null;
  const name = user.providerProfile?.displayName ?? truncateWalletAddress(user.walletAddress);

  const avatarMutation = useMutation({
    mutationFn: (avatarData: string | null) => updateMeAvatar(avatarData),
    onSuccess: ({ avatarData }) => {
      queryClient.setQueryData(queryKeys.me, { user: { ...user, avatarData } });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      void queryClient.invalidateQueries({ queryKey: ['slot'] });
      void queryClient.invalidateQueries({ queryKey: ['my-slots'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-slot'] });
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    },
  });
  const busy = preparing || avatarMutation.isPending;

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setPreparing(true);
    void prepareImage(file, 400)
      .then(({ dataUrl }) => avatarMutation.mutate(dataUrl))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => setPreparing(false));
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Profile picture">
      <div className="flex items-center gap-3">
        <Avatar data={avatar} name={name} size={48} />
        <div className="min-w-0">
          <p className="truncate text-h3 font-semibold text-text">{name}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
            >
              {preparing || avatarMutation.isPending
                ? 'Uploading…'
                : avatar
                  ? 'Change picture'
                  : 'Upload picture'}
            </button>
            {avatar ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => avatarMutation.mutate(null)}
                className="min-h-touch rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose a profile picture"
        onChange={handleFile}
      />
      {error ? (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
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
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Display-name save: on success the parent refreshes its user row and
  // the ['me'] cache is invalidated so every consumer agrees.
  const saveMutation = useMutation({
    mutationFn: (displayName: string) => updateProviderProfile(displayName),
    onSuccess: ({ providerProfile }) => {
      onSaved(providerProfile.displayName);
      setValue('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    },
  });
  const saving = saveMutation.isPending;

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
    saveMutation.mutate(value);
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
