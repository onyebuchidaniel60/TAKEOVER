import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { deriveNimiqAddress } from './nimiq-address';

// Nimiq message-signing envelope, per the official Hub signMessage semantics:
// sign( sha256( '\x16Nimiq Signed Message:\n' + message.length + message ) ).
// Challenge strings are ASCII-only, so string length and UTF-8 byte length agree.
export const NIMIQ_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n';

export interface SignatureVerificationInput {
  /** Canonical (canonicalizeNimiqAddress) wallet address the client claims. */
  address: string;
  /** Exact challenge string reconstructed server-side from the stored row. */
  message: string;
  /** Wallet signature as hex or base64. */
  signature: string;
  /** Wallet public key as hex or base64. Required: without it there is nothing to verify. */
  publicKey?: string;
}

export type VerifySignatureFn = (input: SignatureVerificationInput) => Promise<boolean> | boolean;

function decodeHexOrBase64(value: string, expectedBytes: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    return null;
  }
  let bytes: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length === expectedBytes * 2) {
    bytes = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/=_-]+$/.test(value)) {
    try {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      bytes = Buffer.from(padded, 'base64');
    } catch {
      return null;
    }
  }
  if (!bytes || bytes.length !== expectedBytes) {
    return null;
  }
  return new Uint8Array(bytes);
}

export function nimiqSignedMessageHash(message: string): Uint8Array {
  const envelope = `${NIMIQ_MESSAGE_PREFIX}${message.length}${message}`;
  return createHash('sha256').update(envelope, 'utf8').digest();
}

/**
 * Production Nimiq signature verifier. Pure Ed25519 cryptography — no network,
 * no RPC, no secrets. Returns false (never throws) for any malformed input.
 *
 * Two checks, both required:
 * 1. The public key must derive to the claimed address (binds key to identity;
 *    the wallet may sign with any account, but auth succeeds only for the
 *    address that key actually controls — no impersonation possible).
 * 2. The Ed25519 signature over the enveloped challenge hash must verify.
 */
export function verifyNimiqSignature(input: SignatureVerificationInput): boolean {
  try {
    if (!input.publicKey) {
      return false;
    }
    const publicKey = decodeHexOrBase64(input.publicKey, 32);
    const signature = decodeHexOrBase64(input.signature, 64);
    if (!publicKey || !signature) {
      return false;
    }
    if (deriveNimiqAddress(publicKey) !== input.address) {
      return false;
    }
    const hash = nimiqSignedMessageHash(input.message);
    return nacl.sign.detached.verify(hash, signature, publicKey);
  } catch {
    return false;
  }
}
