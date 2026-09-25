// Dual-identity validation surface (Phase 5g). Email is stored lowercased
// and — under option B (no email service) — never deliverability-checked:
// RFC-lite shape only (has @, has ., no whitespace).
export { normalizeUsername, validateUsername, isReservedUsername } from './username';
export type { UsernameValidationReason } from './username';
export { validatePassword } from './password';
export type { PasswordValidationReason } from './password';

/** Practical cap: 254 chars (RFC 5321). The 16 KB API bodyLimit bounds abuse; this is the shape rule. */
export const EMAIL_MAX_LENGTH = 254;

// Local part + domain + dot-something, no whitespace anywhere. Lite on
// purpose: option B performs no deliverability check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidationReason = 'invalid' | 'format';

/** Trim + lowercase normalization applied before every check and before storage. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Validate a candidate email address. Returns the normalized value on success. */
export function validateEmail(
  input: unknown,
): { ok: true; value: string } | { ok: false; reason: EmailValidationReason } {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const value = normalizeEmail(input);
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(value)) {
    return { ok: false, reason: 'format' };
  }
  return { ok: true, value };
}
