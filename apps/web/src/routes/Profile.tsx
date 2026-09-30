// Own profile (Phase 5k-B) — /profile.
//
// Rewritten to the reference layout: centered identity header, a two-column
// stats row (Openings, Claims; Followers/Following arrive with 5k-C), an
// Information card of private+public rows, and a compact openings preview.
//
// Removed in this rewrite (each was redundant, not useful):
//   - the standalone avatar uploader  -> folded into Edit profile
//   - the provider display-name form  -> folded into Edit profile
//   - the Wallet section              -> now an Information row
//   - the Log out button              -> now a header ghost action
//
// This page is the ONLY surface that renders email/phone/DOB, and it reads
// them from ['me'] (the authenticated projection), never from the public
// endpoint.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, Share2, Wallet } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PublicOpenings from '../components/PublicOpenings';
import {
  EditProfilePill,
  GhostAction,
  InfoIcons,
  InfoRow,
  ProfileHeader,
  ProfileInformation,
  ProfileStats,
  identityLabel,
} from '../components/ProfileView';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import { fetchMe, fetchMyClaims, fetchMySlots, fetchPublicProfile, type MeUser } from '../lib/slots';
import { useAuth } from '../store/auth';
import { useWalletLink } from '../hooks/useWalletLink';
import FieldEditModal, { type EditableField } from '../components/FieldEditModal';

export default function Profile() {
  usePageMeta({ title: 'Profile — TAKEOVER' });
  const logout = useAuth((s) => s.logout);
  const { link, isLinking, error: linkError } = useWalletLink();
  // Phase 5n-B: which single field is being edited, if any.
  const [editing, setEditing] = useState<EditableField | null>(null);

  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  const user: MeUser | null = meQuery.data?.user ?? null;
  // Published openings count + a 3-row preview for the openings section.
  const slotsQuery = useQuery({
    queryKey: queryKeys.mySlots('profile-preview'),
    queryFn: () => fetchMySlots({ status: 'published', limit: 3, offset: 0 }),
  });
  // Claims count. limit 1 is enough — only the server-side total is read.
  const claimsQuery = useQuery({
    queryKey: queryKeys.myClaims,
    queryFn: () => fetchMyClaims({ limit: 1, offset: 0 }),
  });
  // Own follower/following counts. D20: displayed but NOT tappable this
  // phase, so the list routes are not linked from here. The query is keyed
  // on the own handle so it shares cache with the public profile.
  const myUsername = user?.username ?? null;
  const socialQuery = useQuery({
    queryKey: queryKeys.user(myUsername ?? ''),
    queryFn: () => fetchPublicProfile(myUsername as string),
    enabled: myUsername !== null && myUsername !== '',
  });
  const social = socialQuery.data?.profile.stats ?? null;

  if (meQuery.isPending || slotsQuery.isPending || claimsQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <LoadingSkeleton rows={3} />
      </main>
    );
  }

  const firstError = meQuery.error ?? slotsQuery.error ?? claimsQuery.error;
  if (firstError || !user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <ErrorState
          message={
            firstError instanceof ApiError ? firstError.message : 'Something went wrong.'
          }
          onRetry={() => {
            void meQuery.refetch();
            void slotsQuery.refetch();
            void claimsQuery.refetch();
          }}
        />
      </main>
    );
  }

  const name = identityLabel({
    displayName: user.providerProfile?.displayName,
    walletAddress: user.walletAddress,
    username: user.username,
  });
  const openings = slotsQuery.data?.total ?? 0;
  const claims = claimsQuery.data?.total ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-6">
        <ProfileHeader
          avatarData={user.avatarData ?? null}
          name={name}
          username={user.username ?? null}
          bio={user.bio ?? null}
          actions={<HeaderActions username={user.username ?? null} onLogout={() => void logout()} />}
        />

        <ProfileStats
          stats={[
            { label: 'Openings', value: openings },
            { label: 'Claims', value: claims },
            { label: 'Followers', value: social?.followers ?? 0 },
            { label: 'Following', value: social?.following ?? 0 },
          ]}
        />

        <ProfileInformation title="Information">
          <InfoRow
            icon={InfoIcons.email}
            label="Email"
            value={user.email ?? null}
            onEdit={() => setEditing('email')}
          />
          <InfoRow
            icon={InfoIcons.phone}
            label="Phone"
            value={user.phone ?? null}
            onEdit={() => setEditing('phone')}
          />
          <InfoRow
            icon={InfoIcons.dob}
            label="Date of birth"
            value={user.dob ?? null}
            onEdit={() => setEditing('dob')}
          />
          <InfoRow
            icon={InfoIcons.location}
            label="Location"
            value={user.location ?? null}
            onEdit={() => setEditing('location')}
          />
          {/* Wallet (Phase 5n-A). Tappable ONLY while unlinked — that is the
              only state where connecting is possible. Once linked the row is
              read-only, so it drops the chevron and the tap target rather
              than offering an action that would 409. */}
          {user.walletAddress ? (
            <InfoRow
              icon={<Wallet size={16} aria-hidden="true" />}
              label="Wallet"
              value={user.walletAddress}
            />
          ) : (
            <button
              type="button"
              onClick={() => void link()}
              disabled={isLinking}
              className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-ui ease-out-strong disabled:opacity-60"
            >
              <span className="h-4 w-4 shrink-0 text-faint" aria-hidden="true">
                <Wallet size={16} />
              </span>
              <span className="text-body text-text">Wallet</span>
              <span className="ml-auto text-body text-faint">
                {isLinking ? 'Connecting…' : 'Not set'}
              </span>
              <ChevronRight size={16} className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
            </button>
          )}
          {linkError ? (
            <p role="alert" className="px-4 py-3 text-body font-medium text-danger">
              {linkError}
            </p>
          ) : null}
        </ProfileInformation>

        {openings > 0 && user.username ? (
          <PublicOpenings username={user.username} displayName={name} />
        ) : (
          <section className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-h3 font-semibold text-text">Your openings</h2>
            <p className="mt-1 text-body text-muted">
              Nothing listed right now. Released capacity you post shows up here.
            </p>
            <Link
              to="/sell/new"
              className="mt-3 inline-flex min-h-touch items-center justify-center rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink"
            >
              Create an opening
            </Link>
          </section>
        )}
      </div>
      {editing ? (
        <div className="mt-4">
          <FieldEditModal
            field={editing}
            current={
              (editing === 'email'
                ? user.email
                : editing === 'phone'
                  ? user.phone
                  : editing === 'dob'
                    ? user.dob
                    : user.location) ?? null
            }
            onClose={() => setEditing(null)}
          />
        </div>
      ) : null}
    </main>
  );
}

/** Edit pill + share link + log out (the Log out action moved here in 5k-B). */
function HeaderActions({ username, onLogout }: { username: string | null; onLogout: () => void }) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  const handleShare = (): void => {
    if (!username) return;
    const url = `${window.location.origin}/u/${username}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(url)
        .then(() => {
          setCopied(true);
          setShareFailed(false);
        })
        .catch(() => setShareFailed(true));
      return;
    }
    setShareFailed(true);
  };

  return (
    <>
      <EditProfilePill />
      <GhostAction onClick={handleShare} disabled={!username}>
        <Share2 size={16} aria-hidden="true" />
        {shareFailed ? 'Copy failed' : copied ? 'Link copied' : 'Share profile'}
      </GhostAction>
      <GhostAction onClick={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        Log out
      </GhostAction>
    </>
  );
}
