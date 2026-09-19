// Contact-note validator unit tests (no DB). The schema is the
// API boundary: strict shape, trimmed 1–500 chars, null clears, and the
// no-URLs rule (any scheme `://` or `www.`, case-insensitive).
import { describe, expect, it } from 'vitest';
import {
  CONTACT_NOTE_MAX_LENGTH,
  contactNoteBodySchema,
  contactNoteContainsUrl,
} from '../src/slots/validation';

describe('contactNoteContainsUrl', () => {
  it('rejects any scheme with ://', () => {
    for (const value of [
      'call https://example.com/x',
      'see http://example.com',
      'pay ftp://files.example.com',
      'open myapp://deep/link',
    ]) {
      expect(contactNoteContainsUrl(value)).toBe(true);
    }
  });

  it('rejects www. case-insensitively', () => {
    for (const value of ['see www.example.com', 'see WWW.EXAMPLE.COM', 'see Www.Example.com']) {
      expect(contactNoteContainsUrl(value)).toBe(true);
    }
  });

  it('accepts plain text without URLs', () => {
    for (const value of [
      'Meet at the side door.',
      'Ask for Maria at the counter',
      'a',
      'mention www without a dot is fine',
      'slashes // without a colon are fine',
    ]) {
      expect(contactNoteContainsUrl(value)).toBe(false);
    }
  });
});

describe('contactNoteBodySchema', () => {
  it('accepts typical, 1-char, and 500-char notes', () => {
    expect(
      contactNoteBodySchema.safeParse({ provider_contact_note: 'Meet at the side door.' }).success,
    ).toBe(true);
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: 'a' }).success).toBe(true);
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: 'x'.repeat(500) }).success).toBe(
      true,
    );
    expect(CONTACT_NOTE_MAX_LENGTH).toBe(500);
  });

  it('trims before measuring (stored value has no padding)', () => {
    const parsed = contactNoteBodySchema.safeParse({ provider_contact_note: '  hello  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.provider_contact_note).toBe('hello');
    }
  });

  it('rejects empty, whitespace-only, and 501-char notes', () => {
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: '' }).success).toBe(false);
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: '   ' }).success).toBe(false);
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('rejects :// and www. values (case-insensitive)', () => {
    for (const value of [
      'call https://example.com/x',
      'pay myapp://merchant/42',
      'see WWW.example.com/menu',
    ]) {
      expect(contactNoteBodySchema.safeParse({ provider_contact_note: value }).success).toBe(false);
    }
  });

  it('accepts null (clears the note)', () => {
    const parsed = contactNoteBodySchema.safeParse({ provider_contact_note: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.provider_contact_note).toBeNull();
    }
  });

  it('rejects unknown fields and non-string values (strict body)', () => {
    expect(
      contactNoteBodySchema.safeParse({ provider_contact_note: 'ok', extra: 1 }).success,
    ).toBe(false);
    expect(contactNoteBodySchema.safeParse({ provider_contact_note: 42 }).success).toBe(false);
    expect(contactNoteBodySchema.safeParse({}).success).toBe(false);
  });
});
