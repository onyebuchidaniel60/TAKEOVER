// Phase 14l-3: type-scale snapshot — the locked scale from tailwind.config.js.
// display 30/36/-0.02 · h1 24/32/-0.02 · h2 20/28/-0.01 · h3 16/24/-0.01 ·
// body 14/20/0 · small 12/16/+0.01. No surface may use a size outside this
// scale; figures pair a scale size with font-mono + tabular-nums.
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
  it('uses class-driven dark mode', () => {
    expect(CONFIG_TEXT).toContain("darkMode: 'class'");
  });

  it('pairs a system sans stack with a system mono stack for figures', () => {
    expect(CONFIG_TEXT).toContain("'ui-sans-serif'");
    expect(CONFIG_TEXT).toContain("'ui-monospace'");
    // No webfont wired: the fontFamily declaration must not name one
    // (prose comments elsewhere in the file may mention history).
    const familyBlock = CONFIG_TEXT.slice(
      CONFIG_TEXT.indexOf('fontFamily: {'),
      CONFIG_TEXT.indexOf('fontSize: {'),
    );
    expect(familyBlock).not.toContain('Geist');
    expect(familyBlock).not.toContain('@font-face');
  });

  it('locks the six-step scale verbatim', () => {
    for (const entry of [
      "display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }]",
      "h1: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }]",
      "h2: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }]",
      "h3: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }]",
      "body: ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0em' }]",
      "small: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.01em' }]",
    ]) {
      expect(CONFIG_TEXT).toContain(entry);
    }
  });
});
