import { blake2b } from '@noble/hashes/blake2.js';

// Nimiq address primitives, implemented against the official nimiq-keys semantics:
// - address = first 20 bytes of Blake2b-256(Ed25519 public key)
// - user-friendly form = "NQ" + 2 IBAN check digits + 32-char custom-alphabet base32
// - custom alphabet "0123456789ABCDEFGHJKLMNPQRSTUVXY" (no I, O, W, Z)

export const NIMIQ_ADDRESS_LENGTH = 36;

const COUNTRY_CODE = 'NQ';
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY';
const BODY_LENGTH = 32;
const ADDRESS_BYTES = 20;
const PUBLIC_KEY_BYTES = 32;

export class InvalidAddressError extends Error {
  constructor(message = 'Invalid Nimiq address.') {
    super(message);
    this.name = 'InvalidAddressError';
  }
}

// Blake2b-256 (32-byte digest). Pure JS via @noble/hashes: Node's OpenSSL
// provider rejects truncated Blake2b output lengths on this platform.
export function blake2b256(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

export function base32EncodeNimiq(bytes: Uint8Array): string {
  if (bytes.length !== ADDRESS_BYTES) {
    throw new InvalidAddressError();
  }
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += NIMIQ_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += NIMIQ_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32DecodeNimiq(body: string): Uint8Array {
  if (body.length !== BODY_LENGTH) {
    throw new InvalidAddressError();
  }
  const out = new Uint8Array(ADDRESS_BYTES);
  let bits = 0;
  let value = 0;
  let pos = 0;
  for (const char of body) {
    const digit = NIMIQ_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new InvalidAddressError();
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[pos] = (value >>> bits) & 0xff;
      pos += 1;
    }
  }
  if (pos !== ADDRESS_BYTES) {
    throw new InvalidAddressError();
  }
  return out;
}

function ibanMod97(body: string, check: string): number {
  const rearranged = `${body}${COUNTRY_CODE}${check}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    let digits: string;
    if (code >= 48 && code <= 57) {
      digits = char;
    } else if (code >= 65 && code <= 90) {
      digits = String(code - 55);
    } else {
      throw new InvalidAddressError();
    }
    for (const digit of digits) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder;
}

/**
 * Canonical form: no spaces, UPPERCASE (e.g. "NQ32ABCD...").
 * Accepts the spaced user-friendly form and lowercase input, then enforces
 * length, country code, alphabet, and IBAN checksum. Anything else is rejected —
 * malformed input is never silently coerced into a different address.
 */
export function canonicalizeNimiqAddress(input: unknown): string {
  if (typeof input !== 'string') {
    throw new InvalidAddressError();
  }
  const compact = input.replace(/ /g, '').toUpperCase();
  if (compact.length !== NIMIQ_ADDRESS_LENGTH) {
    throw new InvalidAddressError();
  }
  if (!compact.startsWith(COUNTRY_CODE)) {
    throw new InvalidAddressError();
  }
  const check = compact.slice(2, 4);
  const body = compact.slice(4);
  if (!/^[0-9]{2}$/.test(check)) {
    throw new InvalidAddressError();
  }
  for (const char of body) {
    if (!NIMIQ_ALPHABET.includes(char)) {
      throw new InvalidAddressError();
    }
  }
  if (ibanMod97(body, check) !== 1) {
    throw new InvalidAddressError('Invalid Nimiq address checksum.');
  }
  return compact;
}

/** Derive the canonical user-friendly address for a 32-byte Ed25519 public key. */
export function deriveNimiqAddress(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new InvalidAddressError('Invalid public key length.');
  }
  const bytes = blake2b256(publicKey).subarray(0, ADDRESS_BYTES);
  const body = base32EncodeNimiq(bytes);
  const check = String(98 - ibanMod97(body, '00')).padStart(2, '0');
  return `${COUNTRY_CODE}${check}${body}`;
}
