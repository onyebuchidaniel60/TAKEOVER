// Type-scale snapshot — the locked scale from tailwind.config.js.
// display 30/1.2/-0.02 · h1 24/1.2/-0.02 · h2 20/1.3/-0.01 ·
// h3 16/1.3/-0.01 · body 14/1.5/0 · small 12/1.5/+0.01. No surface may
// use a size outside this scale; figures pair a scale size with
// font-mono + tabular-nums. Line heights are unitless spec values
// (design.md §3.3: 1.2 display/h1, 1.3 h2/h3, 1.5 body/small).
//
// The config is plain JS (no allowJs in this workspace), so the test reads
// the file as text and asserts the scale verbatim — a representative read
// of the token. Any scale change fails loudly here by design.
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONFIG_TEXT = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8');

describe('type scale (tailwind.config.js)', () => {
  it('is dark-only: no darkMode switch', () => {
    expect(CONFIG_TEXT).not.toContain('darkMode:');
  });

  it('wires the self-hosted faces: Poppins body, Big Shoulders display, system mono', () => {
    const familyBlock = CONFIG_TEXT.slice(
      CONFIG_TEXT.indexOf('fontFamily: {'),
      CONFIG_TEXT.indexOf('fontSize: {'),
    );
    // Poppins leads sans; the display face leads display; mono stays
    // system-only (figures must never render proportional numerals).
    expect(familyBlock.indexOf("'Poppins'")).toBeGreaterThanOrEqual(0);
    expect(familyBlock.indexOf("'Poppins'")).toBeLessThan(familyBlock.indexOf("'ui-sans-serif'"));
    expect(familyBlock).toContain("'\"Big Shoulders Display\"'");
    expect(familyBlock).toContain("'ui-monospace'");
    expect(familyBlock).not.toContain('Geist');
    // No runtime CDN in the family stacks.
    expect(familyBlock).not.toMatch(/https?:\/\//);
  });

  it('locks the six-step scale verbatim', () => {
    for (const entry of [
      "display: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }]",
      "h1: ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }]",
      "h2: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }]",
      "h3: ['1rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }]",
      "body: ['0.875rem', { lineHeight: '1.5', letterSpacing: '0em' }]",
      "small: ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.01em' }]",
    ]) {
      expect(CONFIG_TEXT).toContain(entry);
    }
  });

  it('ships the six latin woff2 files (self-hosted, no CDN)', () => {
    for (const name of [
      'poppins-400',
      'poppins-500',
      'poppins-600',
      'poppins-700',
      'big-shoulders-600',
      'big-shoulders-700',
    ]) {
      const bytes = readFileSync(resolve(process.cwd(), 'public/fonts', `${name}.woff2`));
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    }
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(css).toContain('font-display: swap');
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('resolves display/h1/h2 to the display face except on mono figures', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('.text-display:not(.font-mono)');
    expect(css).toContain('.text-h1:not(.font-mono)');
    expect(css).toContain('.text-h2:not(.font-mono)');
    expect(css).toContain("'Big Shoulders Display'");
  });
});
