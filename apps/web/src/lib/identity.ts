// Email-identity client (Phase 5j). Thin fetch wrappers over the Phase 5g
// endpoints plus client-side mirrors of the server validation rules.
// Mirrors are UX-only (inline errors before the round trip) — the server
// stays authoritative and anything it still rejects surfaces via ApiError.
// Reserved/taken usernames are NOT mirrored: the debounced availability
// check is the single source of truth for those.
import { apiFetch, setSessionToken } from './api';

export interface IdentityUser {
  id: string;
  email: string | null;
  username: string | null;
  walletAddress: string | null;
  role: string;
  status: string;
}

export interface EmailAuthResponse {
  user: IdentityUser;
  sessionToken: string;
}

export function registerEmail(body: {
  email: string;
  password: string;
  username: string;
}): Promise<EmailAuthResponse> {
  return apiFetch<EmailAuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function loginEmail(body: { email: string; password: string }): Promise<EmailAuthResponse> {
  return apiFetch<EmailAuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Persist the Bearer fallback token after an email auth success (mirrors the wallet flow). */
export function keepSessionToken(response: EmailAuthResponse): void {
  if (typeof response.sessionToken === 'string' && response.sessionToken.length > 0) {
    setSessionToken(response.sessionToken);
  }
}

export interface UsernameAvailability {
  available: boolean;
  reason?: 'format' | 'reserved' | 'taken';
}

export function checkUsernameAvailable(username: string): Promise<UsernameAvailability> {
  return apiFetch<UsernameAvailability>(
    `/api/v1/auth/username-available?username=${encodeURIComponent(username)}`,
  );
}

export interface UserProfilePatch {
  /** Phase 5n-B: email is editable post-signup (it is the login handle). */
  email?: string | null;
  bio?: string | null;
  phone?: string | null;
  dob?: string | null;
  location?: string | null;
}

export interface UserProfileScalars {
  email: string | null;
  bio: string | null;
  phone: string | null;
  dob: string | null;
  location: string | null;
}

export function updateUserProfile(patch: UserProfilePatch): Promise<{ profile: UserProfileScalars }> {
  return apiFetch<{ profile: UserProfileScalars }>('/api/v1/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Phase 5o-A (D26): claim a public handle. Separate endpoint from the profile
 * scalars because the SERVER enforces set-once — this call mirrors the server
 * rule only for the same-value idempotent case, and treats every 409 as
 * terminal (a handle is a one-time action, so there is nothing to retry).
 */
export function setUsername(username: string): Promise<{ username: string; alreadySet: boolean }> {
  return apiFetch<{ username: string; alreadySet: boolean }>('/api/v1/me/username', {
    method: 'PATCH',
    body: JSON.stringify({ username: username.trim().toLowerCase() }),
  });
}

// -- client-side validation mirrors (inline errors only) --------------------
//
// Phase 5n-B: bio/phone/dob/location moved here from routes/onboarding/
// ProfileSetup.tsx. They are mirrors of the SERVER's rules, and the
// single-field edit modal in Profile needs the same ones — two copies of a
// validation rule drift, and a screen is the wrong home for a shared rule.

export function validateBio(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.length > 160) return 'Keep it to 160 characters or fewer.';
  if (/https?:\/\//i.test(value) || /www\./i.test(value)) return 'Bio must not contain links.';
  return null;
}

export function validatePhone(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.length < 3) return 'Phone number looks too short.';
  if (value.length > 32) return 'Phone number must be at most 32 characters.';
  if (!/^[+0-9()\-.\s]+$/.test(value)) return 'Phone number contains invalid characters.';
  return null;
}

export function validateDob(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Use a valid date.';
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    dt.getUTCFullYear() !== Number(match[1]) ||
    dt.getUTCMonth() !== Number(match[2]) - 1 ||
    dt.getUTCDate() !== Number(match[3])
  ) {
    return 'Use a valid date.';
  }
  if (dt.getTime() > Date.now()) return 'Date of birth must be in the past.';
  return null;
}

export function validateLocation(input: string): string | null {
  if (input.trim().length === 0) return null;
  if (input.trim().length > 200) return 'Keep it to 200 characters or fewer.';
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors validateEmail (server): RFC-lite shape on the trimmed value. */
export function validateEmailInput(input: string): string | null {
  const value = input.trim();
  if (value.length === 0 || value.length > 254 || !EMAIL_RE.test(value)) {
    return 'Enter a valid email address.';
  }
  return null;
}

/** Mirrors validatePassword (server): min 8, not equal to email/username. */
export function validatePasswordInput(
  password: string,
  opts: { email?: string; username?: string } = {},
): string | null {
  if (password.length === 0) {
    return 'Enter a password.';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  const lowered = password.toLowerCase();
  if (opts.email && opts.email.trim().length > 0 && lowered === opts.email.trim().toLowerCase()) {
    return 'Password must not match your email.';
  }
  if (
    opts.username &&
    opts.username.trim().length > 0 &&
    lowered === opts.username.trim().toLowerCase()
  ) {
    return 'Password must not match your username.';
  }
  return null;
}

const USERNAME_RE = /^[a-z][a-z0-9_]*$/;

/** Mirrors validateUsername FORMAT rules (server). Reserved/taken come from the availability check. */
export function validateUsernameInput(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (
    value.length < 3 ||
    value.length > 20 ||
    !USERNAME_RE.test(value) ||
    value.includes('__') ||
    value.endsWith('_')
  ) {
    return 'Usernames are 3–20 lowercase letters, numbers, or underscores.';
  }
  return null;
}
