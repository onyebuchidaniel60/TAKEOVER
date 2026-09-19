import { create } from 'zustand';

// Color-theme store. Automatic by default (follows the OS
// prefers-color-scheme query); the Profile toggle persists a manual
// Light / Dark / Auto choice in localStorage under THEME_STORAGE_KEY
// (the same key the pre-paint script in index.html reads, so reloads
// never flash the wrong theme). Applying the theme is class-only —
// instant, no transition: dark mode adds no motion ( table stands).
export type ThemeMode = 'light' | 'dark' | 'auto';

export const THEME_STORAGE_KEY = 'takeover-theme';

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw;
  } catch {
    // Private mode / no storage: fall through to auto.
  }
  return 'auto';
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveIsDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'auto' && systemPrefersDark());
}

/** Apply the resolved theme to <html> (class + colorScheme for native UI). */
export function applyTheme(mode: ThemeMode): void {
  const dark = resolveIsDark(mode);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>()((set) => ({
  mode: readStoredMode(),

  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable: the in-memory mode still applies this session.
    }
    applyTheme(mode);
    set({ mode });
  },
}));

/**
 * Sync the <html> class with the store on boot and with the OS while the
 * mode is Auto (a manual Light/Dark choice never follows the OS). Returns
 * the teardown for the App-level effect.
 */
export function initTheme(): () => void {
  const state = useTheme.getState();
  applyTheme(state.mode);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    if (useTheme.getState().mode === 'auto') {
      applyTheme('auto');
    }
  };
  query.addEventListener('change', onChange);
  const unsubscribe = useTheme.subscribe((s) => applyTheme(s.mode));
  return () => {
    query.removeEventListener('change', onChange);
    unsubscribe();
  };
}
