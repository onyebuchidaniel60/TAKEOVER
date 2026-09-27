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
  bio?: string | null;
  phone?: string | null;
  dob?: string | null;
  location?: string | null;
}

export interface UserProfileScalars {
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

// -- client-side validation mirrors (inline errors only) --------------------

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
