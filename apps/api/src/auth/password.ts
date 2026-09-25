// Email-identity password storage (Phase 5g). scrypt via node:crypto —
// no new dependency, mirroring the pure-JS/built-in crypto discipline of
// auth/nimiq-verify.ts. argon2/bcrypt were rejected: both need a new
// dependency and argon2 wants a native toolchain on Nixpacks.
//
// Stored format (PHC-style, full string goes in users.password_hash):
//   scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>
// Params are parsed back from the stored string on verify, so future
// phases can raise N without breaking existing rows.
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';

function scryptAsync(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) {
        reject(err);
      } else {
        resolve(derived);
      }
    });
  });
}

// OWASP interactive-login params. ~16 MB memory, ~50-100 ms per hash on
// server-class hardware — cheap enough for register/login, expensive
// enough to blunt offline brute force. The 16 KB API bodyLimit bounds
// the hashing input (no separate max length per NIST guidance).
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
export const SCRYPT_SALT_BYTES = 16;

/** Minimum password length (NIST-style: length over complexity). No maximum, no composition rules. */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordValidationReason = 'invalid' | 'too_short' | 'matches_email' | 'matches_username';

/**
 * Pure password policy check. Rejects only: non-strings, < 8 chars, or a
 * password equal to the account's own email/username (case-insensitive).
 * No complexity requirements, no maximum, no breach-corpus check (non-goal).
 */
export function validatePassword(
  plain: unknown,
  opts: { email?: string; username?: string } = {},
): { ok: true } | { ok: false; reason: PasswordValidationReason } {
  if (typeof plain !== 'string' || plain.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }
  const lowered = plain.toLowerCase();
  if (typeof opts.email === 'string' && opts.email.length > 0 && lowered === opts.email.toLowerCase()) {
    return { ok: false, reason: 'matches_email' };
  }
  if (
    typeof opts.username === 'string' &&
    opts.username.length > 0 &&
    lowered === opts.username.toLowerCase()
  ) {
    return { ok: false, reason: 'matches_username' };
  }
  return { ok: true };
}

/** Hash a validated plaintext password. Returns the full storage string (salt embedded). */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = (await scryptAsync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer;
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

interface ParsedPasswordHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function parsePasswordHash(hash: string): ParsedPasswordHash | null {
  if (typeof hash !== 'string') {
    return null;
  }
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  // Sanity bounds: reject absurd params before allocating (a corrupt row
  // must fail closed as "mismatch", never OOM the verifier).
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n < 1024 ||
    n > 1 << 20 ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 8
  ) {
    return null;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return null;
  }
  if (salt.length === 0 || salt.length > 64 || expected.length === 0 || expected.length > 128) {
    return null;
  }
  return { n, r, p, salt, expected };
}

/**
 * Verify a plaintext candidate against a stored hash. Constant-time
 * comparison; any malformed stored hash fails closed (false, never throws).
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    if (typeof plain !== 'string') {
      return false;
    }
    const parsed = parsePasswordHash(hash);
    if (!parsed) {
      return false;
    }
    const derived = (await scryptAsync(plain, parsed.salt, parsed.expected.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    })) as Buffer;
    return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
  } catch {
    return false;
  }
}
