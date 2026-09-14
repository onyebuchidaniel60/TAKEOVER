import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'takeover_session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 32 bytes as base64url without padding.
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface SessionTokenParts {
  sessionId: string;
  secret: Uint8Array;
  secretHash: string;
  token: string;
}

/** Token format: `<sessionId>.<secret>`; only the SHA-256 hash is stored server-side. */
export function createSessionToken(): SessionTokenParts {
  const sessionId = randomUUID();
  const secret = randomBytes(32);
  const secretHash = sha256Hex(secret);
  const token = `${sessionId}.${secret.toString('base64url')}`;
  return { sessionId, secret, secretHash, token };
}

export function parseSessionToken(token: unknown): { sessionId: string; secret: Buffer } | null {
  if (typeof token !== 'string') {
    return null;
  }
  const dot = token.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const sessionId = token.slice(0, dot);
  const secretB64 = token.slice(dot + 1);
  if (!UUID_RE.test(sessionId) || !SECRET_RE.test(secretB64)) {
    return null;
  }
  let secret: Buffer;
  try {
    secret = Buffer.from(secretB64, 'base64url');
  } catch {
    return null;
  }
  if (secret.length !== 32) {
    return null;
  }
  return { sessionId, secret };
}

/**
 * Phase 14c Bearer fallback: extracts the session token from an
 * `Authorization: Bearer <sessionId>.<secret>` header. The extracted value
 * flows through the same parseSessionToken validation (strict format) and the
 * same constant-time sessionHashMatches comparison as the cookie path — the
 * Bearer token IS the session token, not a second credential type. Returns
 * null for any missing/malformed header.
 */
export function parseBearerToken(header: unknown): { sessionId: string; secret: Buffer } | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) {
    return null;
  }
  return parseSessionToken(match[1].trim());
}

/** Constant-time comparison of the stored hash against SHA-256(secret). */
export function sessionHashMatches(storedHex: string, secret: Uint8Array): boolean {
  if (typeof storedHex !== 'string' || !HASH_RE.test(storedHex)) {
    return false;
  }
  const expected = Buffer.from(storedHex, 'hex');
  const actual = Buffer.from(sha256Hex(secret), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
