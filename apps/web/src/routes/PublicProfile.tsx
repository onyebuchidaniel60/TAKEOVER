// Public profile (Phase 5k-B) — /u/:username (D17).
//
// Same presentation as the own profile, different data source and a
// different field set: this page NEVER receives email, phone or DOB,
// because the endpoint's response shape does not contain them. That is
// enforced twice — server-side by the allow-list, and here by simply never
// asking for them. A guard comment would be weaker than an absent field.
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import {
  InfoIcons,
  InfoRow,
  ProfileHeader,
  ProfileInformation,
  ProfileStats,
  identityLabel,
  publicProfileStats,
} from '../components/ProfileView';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import { fetchPublicProfile } from '../lib/slots';
import PublicOpenings from '../components/PublicOpenings';

export default function PublicProfile() {
  const { username = '' } = useParams<{ username: string }>();
  const profileQuery = useQuery({
    queryKey: queryKeys.user(username),
    queryFn: () => fetchPublicProfile(username),
    enabled: username !== '',
  });
  const profile = profileQuery.data?.profile ?? null;
  usePageMeta({ title: profile ? `${profile.displayName} — TAKEOVER` : 'Profile — TAKEOVER' });

  if (profileQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <LoadingSkeleton rows={3} />
      </main>
    );
  }

  if (profileQuery.error || !profile) {
    const notFound = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {notFound ? (
          <EmptyState
            title="Profile not found"
            body="No one here goes by that name."
            action={
              <a
                href="/openings"
                className="inline-block min-h-touch rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink"
              >
                Browse openings
              </a>
            }
          />
        ) : (
          <ErrorState
            message={
              profileQuery.error instanceof ApiError
                ? profileQuery.error.message
                : 'Something went wrong.'
            }
            onRetry={() => void profileQuery.refetch()}
          />
        )}
      </main>
    );
  }

  const name = identityLabel({ displayName: profile.displayName, username: profile.username });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-6">
        <ProfileHeader
          avatarData={profile.avatarData}
          name={name}
          username={profile.username}
          bio={profile.bio}
          // Phase 5k-C replaces this with the Follow button. Rendering
          // nothing rather than a dead control: a Follow affordance that
          // does nothing is worse than its absence.
          actions={null}
        />

        <ProfileStats stats={publicProfileStats(profile, true)} />

        <ProfileInformation title="Information">
          <InfoRow icon={InfoIcons.location} label="Location" value={profile.location} />
          <InfoRow
            icon={InfoIcons.dob}
            label="Member since"
            value={formatMemberSince(profile.memberSince)}
          />
        </ProfileInformation>

        <PublicOpenings username={profile.username} displayName={name} />
      </div>
    </main>
  );
}

/** YYYY-MM-DD -> "April 2026". Unparseable input passes through. */
function formatMemberSince(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
