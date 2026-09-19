// unit tests — no database. Covers display_name validation and
// wallet truncation for provider-facing displays.
import { describe, expect, it } from 'vitest';
import { deriveNimiqAddress, truncateWalletAddress } from '../src/auth/nimiq-address';
import { providerProfileBodySchema } from '../src/provider-profiles/validation';
import { resolveProviderDisplay } from '../src/slots/provider-display';

describe('providerProfileBodySchema', () => {
  it('accepts a normal display name', () => {
    expect(
      providerProfileBodySchema.safeParse({ display_name: 'Sunrise Yoga' }).success,
    ).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    const parsed = providerProfileBodySchema.safeParse({ display_name: '  Café Bar  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.display_name).toBe('Café Bar');
    }
  });

  it('accepts the 2- and 60-character boundaries', () => {
    expect(providerProfileBodySchema.safeParse({ display_name: 'AB' }).success).toBe(true);
    expect(providerProfileBodySchema.safeParse({ display_name: 'x'.repeat(60) }).success).toBe(
      true,
    );
  });

  it('rejects empty, too-short, too-long, and whitespace-only names', () => {
    expect(providerProfileBodySchema.safeParse({ display_name: '' }).success).toBe(false);
    expect(providerProfileBodySchema.safeParse({ display_name: 'A' }).success).toBe(false);
    expect(providerProfileBodySchema.safeParse({ display_name: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(providerProfileBodySchema.safeParse({ display_name: '   ' }).success).toBe(false);
  });

  it('rejects links in any letter case', () => {
    expect(providerProfileBodySchema.safeParse({ display_name: 'see http://x.io' }).success).toBe(
      false,
    );
    expect(providerProfileBodySchema.safeParse({ display_name: 'see https://x.io' }).success).toBe(
      false,
    );
    expect(providerProfileBodySchema.safeParse({ display_name: 'visit www.x.io' }).success).toBe(
      false,
    );
    expect(providerProfileBodySchema.safeParse({ display_name: 'visit WWW.X.IO' }).success).toBe(
      false,
    );
  });

  it('rejects missing and unknown fields', () => {
    expect(providerProfileBodySchema.safeParse({}).success).toBe(false);
    expect(
      providerProfileBodySchema.safeParse({ display_name: 'Fine Name', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('truncateWalletAddress', () => {
  it('formats first 4 + … + last 4 of a canonical wallet', () => {
    expect(truncateWalletAddress('NQ0700000000000000000000000000000000')).toBe('NQ07…0000');
  });

  it('matches the locked example shape for a real derived wallet', () => {
    const wallet = deriveNimiqAddress(new Uint8Array(32).fill(7));
    const truncated = truncateWalletAddress(wallet);
    expect(truncated).toBe(`${wallet.slice(0, 4)}…${wallet.slice(-4)}`);
    expect(truncated).toHaveLength(9);
  });

  it('accepts spaced user-friendly input', () => {
    const wallet = deriveNimiqAddress(new Uint8Array(32).fill(9));
    const spaced = `${wallet.slice(0, 4)} ${wallet.slice(4)}`;
    expect(truncateWalletAddress(spaced)).toBe(truncateWalletAddress(wallet));
  });

  it('never throws on garbage (display-only fallback)', () => {
    expect(() => truncateWalletAddress('not-a-wallet')).not.toThrow();
    expect(truncateWalletAddress('short')).toBe('SHORT');
  });
});

describe('resolveProviderDisplay', () => {
  it('prefers the display name, falls back to the truncated wallet', () => {
    expect(resolveProviderDisplay('Sunrise Yoga', 'NQ0700000000000000000000000000000000')).toBe(
      'Sunrise Yoga',
    );
    expect(resolveProviderDisplay(null, 'NQ0700000000000000000000000000000000')).toBe('NQ07…0000');
    expect(resolveProviderDisplay('   ', 'NQ0700000000000000000000000000000000')).toBe(
      'NQ07…0000',
    );
  });
});
