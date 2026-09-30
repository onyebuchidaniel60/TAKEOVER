// Shared profile presentation (Phase 5k-B).
//
// Own profile (/profile) and public profile (/u/:username) differ only in
// WHICH fields they may show and which actions they offer — not in layout.
// Both render these primitives, so the two pages cannot drift.
//
// Privacy: <ProfileInformation> is the single place private rows (email,
// phone, DOB) are rendered, and it takes them as explicit props. The public
// page passes nothing private, so a leak has to be added deliberately at the
// call site rather than happening because a whole user object was spread in.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronRight, Mail, MapPin, Pencil, Phone } from 'lucide-react';
import Avatar from './Avatar';
import { truncateWalletAddress } from '../lib/slots';
import type { PublicProfile } from '../lib/slots';

/**
 * Avatar diameter. The reference sheet reads heavier (~85px in a 390px
 * phone); 64px is the top of the Phase-5k brief's 48-64px range and keeps
 * the header from pushing the stats row below the fold at 320px.
 */
export const PROFILE_AVATAR_SIZE = 64;

/** Identity label: display name, else truncated wallet, else @handle. */
export function identityLabel(input: {
  displayName?: string | null;
  walletAddress?: string | null;
  username?: string | null;
}): string {
  if (input.displayName && input.displayName.trim() !== '') return input.displayName;
  if (input.walletAddress) return truncateWalletAddress(input.walletAddress);
  if (input.username) return `@${input.username}`;
  return 'TAKEOVER user';
}

type ProfileHeaderProps = {
  avatarData: string | null;
  name: string;
  /** Handle without the leading '@'; null when the account has none. */
  username: string | null;
  bio: string | null;
  /** Action row (Edit / Share / Log out / Follow). */
  actions?: ReactNode;
};

/** Centered identity block: avatar, name, handle, bio, actions. */
export function ProfileHeader({ avatarData, name, username, bio, actions }: ProfileHeaderProps) {
  return (
    <header className="flex flex-col items-center text-center">
      <Avatar data={avatarData} name={name} size={PROFILE_AVATAR_SIZE} />
      <h1 className="mt-3 text-h2 font-bold text-text">{name}</h1>
      {username ? <p className="mt-0.5 text-body text-muted">@{username}</p> : null}
      {bio ? (
        <p className="mt-2 max-w-sm text-body text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {bio}
        </p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </header>
  );
}

type ProfileStatsProps = {
  stats: { label: string; value: number | string }[];
};

/** Stat row: mono tabular figures over small muted labels. */
export function ProfileStats({ stats }: ProfileStatsProps) {
  return (
    <dl className="grid grid-cols-2 gap-4 rounded-card border border-border bg-surface p-4">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col items-center">
          <dd className="font-mono text-h2 font-bold tabular-nums text-text">{stat.value}</dd>
          <dt className="mt-0.5 text-small text-muted">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}

const INFO_ICON = 'h-4 w-4 shrink-0 text-faint';

type InfoRowProps = {
  icon: ReactNode;
  label: string;
  value: string | null;
  /** When set, the row becomes a link (used for "Not set" -> edit). */
  to?: string;
  /** Shown instead of the raw value when the value is empty. */
  emptyLabel?: string;
};

/** One Information row: muted icon, label, right-aligned value, chevron. */
export function InfoRow({ icon, label, value, to, emptyLabel = 'Not set' }: InfoRowProps) {
  const shown = value && value.trim() !== '' ? value : emptyLabel;
  const isEmpty = !value || value.trim() === '';
  const body = (
    <>
      <span className={INFO_ICON} aria-hidden="true">
        {icon}
      </span>
      <span className="shrink-0 text-body text-text">{label}</span>
      {/* min-w-0 + truncate: without it a long value (an email address) cannot
          shrink, and the row pushes the card past a 320px viewport. */}
      <span
        className={`ml-auto min-w-0 truncate text-right text-body ${isEmpty ? 'text-faint' : 'text-muted'}`}
        title={shown}
      >
        {shown}
      </span>
      {to ? <ChevronRight size={16} className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" /> : null}
    </>
  );
  const className =
    'flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-ui ease-out-strong';
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

/** Bordered card of Information rows. */
export function ProfileInformation({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface" aria-label={title}>
      <h2 className="border-b border-border px-4 py-3 text-h3 font-semibold text-text">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** Row icons, named so both pages stay consistent. */
export const InfoIcons = {
  email: <Mail size={16} aria-hidden="true" />,
  phone: <Phone size={16} aria-hidden="true" />,
  dob: <Calendar size={16} aria-hidden="true" />,
  location: <MapPin size={16} aria-hidden="true" />,
} as const;

/** Secondary pill used for the header action row. */
export function SecondaryPill({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-touch items-center justify-center rounded-pill border border-border-strong bg-surface px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
    >
      {children}
    </Link>
  );
}

/** Tertiary ghost action (Log out, Share). No fill, no border. */
export function GhostAction({ children, ...rest }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="inline-flex min-h-touch items-center justify-center gap-1.5 rounded-pill px-3 py-2 text-body font-medium text-muted transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/** "Edit profile" pill, pre-wired to the settings variant of onboarding. */
export function EditProfilePill() {
  return (
    <SecondaryPill to="/onboarding/profile?from=settings">
      <Pencil size={16} aria-hidden="true" className="mr-1.5" />
      Edit profile
    </SecondaryPill>
  );
}

/** Build the stats row for a public profile response. */
export function publicProfileStats(profile: PublicProfile, includeSocial = false) {
  const stats = [
    { label: 'Openings', value: profile.stats.openings },
    { label: 'Claims', value: profile.stats.claims },
  ];
  if (includeSocial) {
    stats.push(
      { label: 'Followers', value: profile.stats.followers },
      { label: 'Following', value: profile.stats.following },
    );
  }
  return stats;
}
