// Onboarding state helpers (Phase 5j). Session-scoped by design:
// interests seed the feed filter on the first Home visit only, and the
// welcome banner shows once on the first-action screen. Nothing here
// persists across sessions — that is a future enhancement (5k+).
import { SLOT_CATEGORIES } from './slots';

const INTERESTS_KEY = 'takeover.interests';
const WELCOME_BANNER_KEY = 'takeover.welcomeBanner';

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Persist the selected interest categories (multi-select, SLOT_CATEGORIES values). */
export function saveInterests(categories: string[]): void {
  const store = storage();
  if (!store) return;
  try {
    const known = categories.filter((c) => (SLOT_CATEGORIES as readonly string[]).includes(c));
    store.setItem(INTERESTS_KEY, JSON.stringify(known));
  } catch {
    // Private mode / quota: interests simply don't seed the feed.
  }
}

/**
 * Read-once interests for the feed filter. Returns the stored categories
 * (possibly empty) and removes the key so later Home visits never fight
 * the user's own filter choices.
 */
export function consumeOnboardingInterests(): string[] | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(INTERESTS_KEY);
    store.removeItem(INTERESTS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (c): c is string =>
        typeof c === 'string' && (SLOT_CATEGORIES as readonly string[]).includes(c),
    );
  } catch {
    return null;
  }
}

/** Arm the first-action welcome banner (called when leaving interests). */
export function showWelcomeBanner(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(WELCOME_BANNER_KEY, '1');
  } catch {
    // No banner without storage — the app still works.
  }
}

/** Read-once welcome-banner flag for the first-action screen. */
export function consumeWelcomeBanner(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(WELCOME_BANNER_KEY);
    store.removeItem(WELCOME_BANNER_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

// -- redirect decision (pure, unit-tested) -----------------------------------

export interface OnboardingGuardState {
  initialized: boolean;
  status: 'unauthenticated' | 'authenticating' | 'authenticated';
  onboardedAt: string | null;
}

function isOnboardingPath(pathname: string): boolean {
  return pathname === '/welcome' || pathname === '/login' || pathname.startsWith('/onboarding/');
}

/**
 * Single redirect decision for the whole onboarding matrix. Returns the
 * target path or null when no redirect applies. Called from the
 * OnboardingRedirect component on every location/auth change.
 *
 * - Not initialized / mid-login: never redirect (let the flow settle).
 * - Guests: /welcome, /login, and /onboarding/account (the signup screen
 *   itself) stay public; /onboarding/profile + /onboarding/interests
 *   bounce to /welcome. (Account MUST serve guests — it is where accounts
 *   get created. The plan's "/onboarding/*" bullet reads with that
 *   exception; applied literally it would make signup unreachable.)
 * - Fresh account (onboarded_at NULL): everything outside the onboarding
 *   area → /welcome; the app unlocks only through the flow.
 * - Onboarded: /welcome, /login, /onboarding/* → / (Home).
 */
export function onboardingRedirect(
  state: OnboardingGuardState,
  pathname: string,
  search?: string,
): string | null {
  if (!state.initialized || state.status === 'authenticating') {
    return null;
  }
  if (state.status !== 'authenticated') {
    if (pathname === '/onboarding/account') {
      return null;
    }
    if (pathname.startsWith('/onboarding/')) {
      return '/welcome';
    }
    return null;
  }
  if (state.onboardedAt === null) {
    return isOnboardingPath(pathname) ? null : '/welcome';
  }
  // Phase 5k-B: the Profile page reuses this screen as its Edit form. An
  // onboarded user normally never belongs in /onboarding/*, so the guard
  // sends them home — but the explicit `?from=settings` variant is an edit
  // affordance reached from /profile, not an onboarding step. Every other
  // /onboarding/* path is still redirected exactly as before.
  if (isSettingsVariant(pathname, search)) {
    return null;
  }
  if (pathname === '/welcome' || pathname === '/login' || pathname.startsWith('/onboarding/')) {
    return '/';
  }
  return null;
}

const SETTINGS_FLAG = 'from=settings';

/** True only for /onboarding/profile?from=settings. */
function isSettingsVariant(pathname: string, search?: string): boolean {
  return pathname === '/onboarding/profile' && search === `?${SETTINGS_FLAG}`;
}
