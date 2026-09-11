import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import {
  base32DecodeNimiq,
  base32EncodeNimiq,
  blake2b256,
  canonicalizeNimiqAddress,
  deriveNimiqAddress,
  InvalidAddressError,
} from '../src/auth/nimiq-address';
import {
  CHALLENGE_PREFIX,
  CHALLENGE_TTL_MS,
  createNonce,
  formatChallenge,
  SESSION_TTL_MS,
} from '../src/auth/challenge';
import {
  createSessionToken,
  parseSessionToken,
  sessionHashMatches,
  sha256Hex,
} from '../src/auth/session-token';
import { nimiqSignedMessageHash, verifyNimiqSignature } from '../src/auth/nimiq-verify';

const ZERO_ADDRESS_SPACED = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';

describe('canonicalizeNimiqAddress', () => {
  it('accepts the spaced user-friendly form and canonicalizes it', () => {
    expect(canonicalizeNimiqAddress(ZERO_ADDRESS_SPACED)).toBe(
      ZERO_ADDRESS_SPACED.replace(/ /g, ''),
    );
  });

  it('accepts lowercase input', () => {
    expect(canonicalizeNimiqAddress(ZERO_ADDRESS_SPACED.toLowerCase())).toBe(
      ZERO_ADDRESS_SPACED.replace(/ /g, ''),
    );
  });

  it('rejects a bad checksum', () => {
    expect(() => canonicalizeNimiqAddress('NQ08 0000 0000 0000 0000 0000 0000 0000 0000')).toThrow(
      InvalidAddressError,
    );
  });

  it.each([
    ['wrong length', 'NQ07 0000'],
    ['wrong country code', 'XX07 0000 0000 0000 0000 0000 0000 0000 0000'],
    ['non-numeric check digits', 'NQAB 0000 0000 0000 0000 0000 0000 0000 0000'],
    // I is outside the Nimiq base32 alphabet.
    ['bad alphabet', 'NQ07 I000 0000 0000 0000 0000 0000 0000 0000'],
    ['empty', ''],
    ['SQL injection', "' OR '1'='1"],
  ])('rejects %s without coercion', (_label, input) => {
    expect(() => canonicalizeNimiqAddress(input)).toThrow(InvalidAddressError);
  });

  it('rejects non-string input', () => {
    expect(() => canonicalizeNimiqAddress(undefined)).toThrow(InvalidAddressError);
    expect(() => canonicalizeNimiqAddress(42)).toThrow(InvalidAddressError);
  });
});

describe('nimiq base32 + hashing primitives', () => {
  it('matches the BLAKE2b-256 empty-input test vector', () => {
    expect(Buffer.from(blake2b256(new Uint8Array(0))).toString('hex')).toBe(
      '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8',
    );
  });

  it('decodes the all-zero address body to 20 zero bytes', () => {
    expect(Array.from(base32DecodeNimiq('0'.repeat(32)))).toEqual(new Array(20).fill(0));
  });

  it('round-trips arbitrary 20-byte addresses', () => {
    const bytes = new Uint8Array(20).map((_, i) => (i * 37 + 11) & 0xff);
    expect(base32DecodeNimiq(base32EncodeNimiq(bytes))).toEqual(bytes);
  });

  it('derives canonical addresses that re-validate', () => {
    const publicKey = new Uint8Array(32).map((_, i) => (i * 91 + 7) & 0xff);
    const address = deriveNimiqAddress(publicKey);
    expect(address).toHaveLength(36);
    expect(address.startsWith('NQ')).toBe(true);
    expect(canonicalizeNimiqAddress(address)).toBe(address);
  });
});

describe('challenge formatting', () => {
  it('formats the exact challenge string', () => {
    const nonce = 'ab'.repeat(32);
    expect(formatChallenge(nonce, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      `TAKEOVER-AUTH:v1:${nonce}:2026-01-01T00:00:00.000Z`,
    );
  });

  it('uses the locked prefix and 5-minute TTL', () => {
    expect(CHALLENGE_PREFIX).toBe('TAKEOVER-AUTH:v1');
    expect(CHALLENGE_TTL_MS).toBe(5 * 60 * 1000);
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('creates 32-byte hex nonces', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('session tokens', () => {
  it('matches the SHA-256 test vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('round-trips create -> parse, and the hash matches the secret', () => {
    const created = createSessionToken();
    const parsed = parseSessionToken(created.token);
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe(created.sessionId);
    expect(sessionHashMatches(created.secretHash, parsed?.secret ?? new Uint8Array(0))).toBe(true);
  });

  it('rejects a wrong secret against the stored hash', () => {
    const created = createSessionToken();
    const other = createSessionToken();
    expect(sessionHashMatches(created.secretHash, other.secret)).toBe(false);
  });

  it.each([
    ['no separator', 'justasessionid'],
    ['bad uuid', 'not-a-uuid.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['bad secret', `${createSessionToken().sessionId}.short`],
    ['non-string', undefined],
  ])('rejects malformed token (%s)', (_label, input) => {
    expect(parseSessionToken(input)).toBeNull();
  });
});

describe('verifyNimiqSignature', () => {
  const keyPair = nacl.sign.keyPair.fromSeed(
    Uint8Array.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 5) & 0xff)),
  );
  const address = deriveNimiqAddress(keyPair.publicKey);
  const message = formatChallenge('cd'.repeat(32), new Date('2026-02-02T00:00:00.000Z'));

  function signFor(secretKey: Uint8Array, msg: string): string {
    const hash = nimiqSignedMessageHash(msg);
    return Buffer.from(nacl.sign.detached(hash, secretKey)).toString('hex');
  }

  const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

  it('accepts a valid signature over the enveloped challenge', () => {
    expect(
      verifyNimiqSignature({
        address,
        message,
        signature: signFor(keyPair.secretKey, message),
        publicKey: publicKeyHex,
      }),
    ).toBe(true);
  });

  it('rejects a signature for a different message', () => {
    expect(
      verifyNimiqSignature({
        address,
        message: `${message}tampered`,
        signature: signFor(keyPair.secretKey, message),
        publicKey: publicKeyHex,
      }),
    ).toBe(false);
  });

  it('rejects when the key does not control the claimed address', () => {
    const other = nacl.sign.keyPair();
    expect(
      verifyNimiqSignature({
        address,
        message,
        signature: signFor(other.secretKey, message),
        publicKey: Buffer.from(other.publicKey).toString('hex'),
      }),
    ).toBe(false);
  });

  it('rejects missing public key and malformed signatures', () => {
    const valid = signFor(keyPair.secretKey, message);
    expect(verifyNimiqSignature({ address, message, signature: valid })).toBe(false);
    expect(
      verifyNimiqSignature({ address, message, signature: 'not-hex!', publicKey: publicKeyHex }),
    ).toBe(false);
    expect(
      verifyNimiqSignature({
        address,
        message,
        signature: 'ab'.repeat(10),
        publicKey: publicKeyHex,
      }),
    ).toBe(false);
  });
});
