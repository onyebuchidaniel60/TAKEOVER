import { randomBytes } from 'node:crypto';

export const CHALLENGE_PREFIX = 'TAKEOVER-AUTH:v1';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 CSPRNG bytes as lowercase hex. */
export function createNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Exact bytes the wallet signs. Reconstructed server-side from the stored
 * challenge row at verify time — the client only ever sends the nonce.
 * ASCII-only by construction, so UTF-8 and UTF-16 length measures agree.
 */
export function formatChallenge(nonce: string, issuedAt: Date): string {
  return `${CHALLENGE_PREFIX}:${nonce}:${issuedAt.toISOString()}`;
}
