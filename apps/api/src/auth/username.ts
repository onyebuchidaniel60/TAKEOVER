// Username validation (Phase 5g). Usernames are required, unique, stored
// lowercased, and immutable after set (the stable public handle for /u/:username
// in a later phase; provider_profiles.display_name stays the mutable friendly name).
//
// Rules: 3–20 chars, lowercase [a-z0-9_], must start with a letter (which
// also rules out pure-number handles and the /u/123 ambiguity), no
// consecutive underscores, cannot end with an underscore. Input is
// trimmed + lowercased before validation, so "Alice" registers as "alice".
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Reserved handles (case-insensitive — everything is lowercased first).
 * Covers the phase brief's list plus every first route segment in the web
 * app (/, /openings, /slot, /claim, /claims, /sell, /notifications,
 * /profile, /admin and its nested pages) and every /api/v1 segment
 * (auth, me, slots, claims, escrow, reports, payments, provider, config,
 * notifications, admin) plus generic web segments (home, search, about,
 * terms, privacy, wallet, pay, checkout, explore, feed, follow, ...),
 * so a future /u/:username route can never shadow a real page or endpoint.
 */
const RESERVED_USERNAMES = new Set([
  'about',
  'admin',
  'api',
  'app',
  'audit',
  'auth',
  'challenge',
  'checkout',
  'claim',
  'claims',
  'config',
  'escrow',
  'explore',
  'feed',
  'follow',
  'followers',
  'following',
  'health',
  'help',
  'home',
  'login',
  'logout',
  'me',
  'new',
  'notification',
  'notifications',
  'openings',
  'pay',
  'payment',
  'payments',
  'privacy',
  'profile',
  'provider',
  'register',
  'reports',
  'search',
  'sell',
  'settings',
  'signup',
  'slot',
  'slots',
  'support',
  'takeover',
  'terms',
  'u',
  'user',
  'username',
  'users',
  'verify',
  'wallet',
]);

export type UsernameValidationReason = 'invalid' | 'format' | 'reserved';

/** Lowercase + trim normalization applied before every check and before storage. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

const USERNAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Validate a candidate handle. Returns the normalized value on success.
 * 'taken' is NOT decided here — the availability endpoint / register flow
 * checks the database and reports 'taken' separately.
 */
export function validateUsername(
  input: unknown,
): { ok: true; value: string } | { ok: false; reason: UsernameValidationReason } {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const value = normalizeUsername(input);
  if (
    value.length < USERNAME_MIN_LENGTH ||
    value.length > USERNAME_MAX_LENGTH ||
    !USERNAME_RE.test(value) ||
    value.includes('__') ||
    value.endsWith('_')
  ) {
    return { ok: false, reason: 'format' };
  }
  if (RESERVED_USERNAMES.has(value)) {
    return { ok: false, reason: 'reserved' };
  }
  return { ok: true, value };
}

/** True when the normalized handle is on the reserved list (for tests/docs). */
export function isReservedUsername(input: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(input));
}
