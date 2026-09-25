// lib/image.ts: byte-length math (pure, node env) — the canvas path is
// covered in avatar-image.test.tsx with stubbed platform APIs.
import { describe, expect, it } from 'vitest';
import { dataUriByteLength, IMAGE_MAX_BYTES } from '../src/lib/image';

describe('dataUriByteLength', () => {
  it('measures decoded bytes, not base64 chars', () => {
    expect(dataUriByteLength(`data:image/jpeg;base64,${'A'.repeat(1024)}`)).toBe(768);
    expect(dataUriByteLength('data:image/png;base64,iVBORw0KGgo=')).toBe(8);
  });

  it('returns Infinity for malformed input (never fits, never crashes)', () => {
    expect(dataUriByteLength('not-a-uri')).toBe(Number.POSITIVE_INFINITY);
  });

  it('caps at 200KB', () => {
    expect(IMAGE_MAX_BYTES).toBe(200 * 1024);
  });
});
