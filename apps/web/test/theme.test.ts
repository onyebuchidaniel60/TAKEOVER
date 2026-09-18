// @vitest-environment jsdom
// Phase 14l-3: theme store — Auto follows the OS, a manual Light/Dark/Auto
// choice persists in localStorage, and applying the theme is class-only
// (instant, no transition — dark mode adds no motion).
import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

async function freshTheme(darkOS: boolean): Promise<typeof import('../src/store/theme')> {
  vi.resetModules();
  stubMatchMedia(darkOS);
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  return import('../src/store/theme');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

describe('theme store', () => {
  it('defaults to Auto and follows a dark OS', async () => {
    const theme = await freshTheme(true);
    expect(theme.useTheme.getState().mode).toBe('auto');
    expect(theme.resolveIsDark('auto')).toBe(true);
  });

  it('Auto follows a light OS', async () => {
    const theme = await freshTheme(false);
    expect(theme.resolveIsDark('auto')).toBe(false);
  });

  it('a manual Dark choice wins over a light OS and persists across reload', async () => {
    const first = await freshTheme(false);
    first.useTheme.getState().setMode('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(first.THEME_STORAGE_KEY)).toBe('dark');

    // "Reload": fresh module read picks up the stored choice.
    vi.resetModules();
    stubMatchMedia(false);
    const second = await import('../src/store/theme');
    expect(second.useTheme.getState().mode).toBe('dark');
    expect(second.resolveIsDark(second.useTheme.getState().mode)).toBe(true);
  });

  it('Light removes the dark class even on a dark OS', async () => {
    const theme = await freshTheme(true);
    theme.useTheme.getState().setMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(localStorage.getItem(theme.THEME_STORAGE_KEY)).toBe('light');
  });

  it('Auto re-resolves when picked after a manual choice', async () => {
    const theme = await freshTheme(true);
    theme.useTheme.getState().setMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    theme.useTheme.getState().setMode('auto');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
