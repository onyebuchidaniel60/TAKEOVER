// @vitest-environment jsdom
// Phase 5j onboarding suite: the pure redirect matrix, safe redirect
// targets, client validation mirrors, session-scoped interest storage,
// screen renders + flows (mocked fetch), feed seeding, and axe on every
// new screen (zero critical/serious).
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeedSection from '../src/components/FeedSection';
import ProductTour from '../src/components/tour/ProductTour';
import ProductTourHost from '../src/components/tour/ProductTourHost';
import { resolveTourStops, TOUR_STOPS } from '../src/components/tour/tour-steps';
import Account from '../src/routes/onboarding/Account';
import Interests from '../src/routes/onboarding/Interests';
import ProfileSetup from '../src/routes/onboarding/ProfileSetup';
import Login, { safeRedirectTarget } from '../src/routes/Login';
import Welcome from '../src/routes/Welcome';
import { useAuth } from '../src/store/auth';
import {
  consumeOnboardingInterests,
  consumeWelcomeBanner,
  onboardingRedirect,
  saveInterests,
  showWelcomeBanner,
} from '../src/lib/onboarding';
import {
  validateEmailInput,
  validatePasswordInput,
  validateUsernameInput,
} from '../src/lib/identity';
import { renderWithClient } from './test-utils';
import {
  assertZeroCriticalOrSerious,
  err,
  meFixture,
  mockFetch,
  runAxe,
} from './a11y-helpers';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function setFreshAccount(): void {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'fresh-1', walletAddress: null, role: 'buyer', status: 'active', onboardedAt: null },
    error: null,
    initialized: true,
  });
}

const freshMe = (): Record<string, unknown> => ({ ...meFixture(), onboardedAt: null });

describe('onboardingRedirect (pure matrix)', () => {
  it('waits while uninitialized or authenticating', () => {
    expect(
      onboardingRedirect({ initialized: false, status: 'unauthenticated', onboardedAt: null }, '/sell'),
    ).toBeNull();
    expect(
      onboardingRedirect({ initialized: true, status: 'authenticating', onboardedAt: null }, '/welcome'),
    ).toBeNull();
  });

  it('sends guests on authed onboarding steps to /welcome; account stays public', () => {
    const guest = { initialized: true as const, status: 'unauthenticated' as const, onboardedAt: null };
    expect(onboardingRedirect(guest, '/onboarding/profile')).toBe('/welcome');
    expect(onboardingRedirect(guest, '/onboarding/interests')).toBe('/welcome');
    // /onboarding/account is the signup screen — it MUST serve guests.
    expect(onboardingRedirect(guest, '/onboarding/account')).toBeNull();
    expect(onboardingRedirect(guest, '/welcome')).toBeNull();
    expect(onboardingRedirect(guest, '/login')).toBeNull();
    expect(onboardingRedirect(guest, '/')).toBeNull();
    expect(onboardingRedirect(guest, '/sell/new')).toBeNull();
  });

  it('keeps fresh accounts inside the onboarding area', () => {
    const fresh = { initialized: true as const, status: 'authenticated' as const, onboardedAt: null };
    expect(onboardingRedirect(fresh, '/')).toBe('/welcome');
    expect(onboardingRedirect(fresh, '/sell/new')).toBe('/welcome');
    expect(onboardingRedirect(fresh, '/profile')).toBe('/welcome');
    expect(onboardingRedirect(fresh, '/welcome')).toBeNull();
    expect(onboardingRedirect(fresh, '/login')).toBeNull();
    expect(onboardingRedirect(fresh, '/onboarding/account')).toBeNull();
    expect(onboardingRedirect(fresh, '/onboarding/profile')).toBeNull();
    expect(onboardingRedirect(fresh, '/onboarding/interests')).toBeNull();
  });

  it('sends onboarded users away from onboarding routes', () => {
    const done = {
      initialized: true as const,
      status: 'authenticated' as const,
      onboardedAt: new Date().toISOString(),
    };
    expect(onboardingRedirect(done, '/welcome')).toBe('/');
    expect(onboardingRedirect(done, '/login')).toBe('/');
    expect(onboardingRedirect(done, '/onboarding/account')).toBe('/');
    expect(onboardingRedirect(done, '/')).toBeNull();
    expect(onboardingRedirect(done, '/sell/new')).toBeNull();
    expect(onboardingRedirect(done, '/admin')).toBeNull();
  });
});

describe('safeRedirectTarget', () => {
  it('accepts same-origin paths, rejects everything else', () => {
    expect(safeRedirectTarget('/sell/new')).toBe('/sell/new');
    expect(safeRedirectTarget('/')).toBe('/');
    expect(safeRedirectTarget(null)).toBeNull();
    expect(safeRedirectTarget('')).toBeNull();
    expect(safeRedirectTarget('//evil.com/x')).toBeNull();
    expect(safeRedirectTarget('https://evil.com/')).toBeNull();
    expect(safeRedirectTarget('javascript:alert(1)')).toBeNull();
  });
});

describe('client validation mirrors', () => {
  it('email: RFC-lite shape', () => {
    expect(validateEmailInput('a@b.c')).toBeNull();
    expect(validateEmailInput('  A@B.C  ')).toBeNull();
    expect(validateEmailInput('no-at')).not.toBeNull();
    expect(validateEmailInput('a@b')).not.toBeNull();
    expect(validateEmailInput('')).not.toBeNull();
  });

  it('password: min 8, not equal to email/username', () => {
    expect(validatePasswordInput('long-enough', {})).toBeNull();
    expect(validatePasswordInput('', {})).not.toBeNull();
    expect(validatePasswordInput('short', {})).not.toBeNull();
    expect(validatePasswordInput('Alice@Test.Local', { email: 'alice@test.local' })).not.toBeNull();
    expect(validatePasswordInput('test_alice', { username: 'test_alice' })).not.toBeNull();
  });

  it('username: format rules only (reserved/taken are server-side)', () => {
    expect(validateUsernameInput('alice_1')).toBeNull();
    expect(validateUsernameInput('Alice')).toBeNull();
    expect(validateUsernameInput('ab')).not.toBeNull();
    expect(validateUsernameInput('1abc')).not.toBeNull();
    expect(validateUsernameInput('a__b')).not.toBeNull();
    expect(validateUsernameInput('abc_')).not.toBeNull();
    // Reserved passes the FORMAT mirror — the availability check owns it.
    expect(validateUsernameInput('admin')).toBeNull();
  });
});

describe('interest storage (session-scoped, read-once)', () => {
  it('round-trips, filters unknown values, and consumes once', () => {
    expect(consumeOnboardingInterests()).toBeNull();
    saveInterests(['Event', 'Bogus', 'Salon / service']);
    expect(consumeOnboardingInterests()).toEqual(['Event', 'Salon / service']);
    expect(consumeOnboardingInterests()).toBeNull();
  });

  it('welcome banner flag is read-once', () => {
    expect(consumeWelcomeBanner()).toBe(false);
    showWelcomeBanner();
    expect(consumeWelcomeBanner()).toBe(true);
    expect(consumeWelcomeBanner()).toBe(false);
  });
});

describe('Welcome screen', () => {
  it('renders verbatim copy, both CTAs, and passes axe', async () => {
    const { container } = renderWithClient(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/onboarding/account" element={<div>account-stub</div>} />
          <Route path="/login" element={<div>login-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Welcome to TAKEOVER')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Good openings go fast.' })).toBeDefined();
    expect(screen.getByText(/Claim one in a couple of taps\./)).toBeDefined();
    expect(screen.getByText('Already have an account?')).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Get started' }));
    expect(await screen.findByText('account-stub')).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), '/welcome');
  });

  it('secondary pill navigates to login', async () => {
    renderWithClient(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/login" element={<div>login-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByText('login-stub')).toBeDefined();
  });
});

describe('Account screen', () => {
  function renderAccount() {
    return renderWithClient(
      <MemoryRouter initialEntries={['/onboarding/account']}>
        <Routes>
          <Route path="/onboarding/account" element={<Account />} />
          <Route path="/onboarding/profile" element={<div>profile-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows both tabs immediately, wallet by default', async () => {
    renderAccount();
    // Both sign-up paths are visible from the start (5j-2 correction).
    const walletTab = screen.getByRole('tab', { name: 'Wallet' });
    const emailTab = screen.getByRole('tab', { name: 'Email' });
    expect(walletTab.getAttribute('aria-selected')).toBe('true');
    expect(emailTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'Continue with wallet' })).toBeDefined();
    expect(screen.getByText(/this is where you.*ll sign payments too/)).toBeDefined();
    // Email form hidden until its tab is picked…
    expect(screen.queryByLabelText('Email')).toBeNull();
    const user = userEvent.setup();
    await user.click(emailTab);
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByLabelText('Username')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Email' }).getAttribute('aria-selected')).toBe('true');
  });

  it('flags invalid input inline without calling the API', { timeout: 30_000 }, async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return {};
    });
    renderAccount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Username'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeDefined();
    expect(calls).toBe(0);
  });

  it('reports live availability and maps server field errors', { timeout: 30_000 }, async () => {
    mockFetch((url) => {
      if (url.includes('/api/v1/auth/username-available')) {
        return url.includes('taken_name')
          ? { available: false, reason: 'taken' }
          : { available: true };
      }
      if (url.endsWith('/api/v1/auth/register')) {
        return err(409, 'EMAIL_TAKEN', 'This email is already registered.');
      }
      return {};
    });
    renderAccount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByLabelText('Username'), 'taken_name');
    // Debounce-dependent (400ms + render): explicit budget for slow boxes.
    expect(await screen.findByText('This username is already taken.', {}, { timeout: 5000 })).toBeDefined();
    await user.clear(screen.getByLabelText('Username'));
    await user.type(screen.getByLabelText('Username'), 'fresh_handle');
    expect(await screen.findByText('That username is available.', {}, { timeout: 5000 })).toBeDefined();
    await user.type(screen.getByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This email is already registered.')).toBeDefined();
  });

  it('registers and advances to profile setup', { timeout: 30_000 }, async () => {
    mockFetch((url) => {
      if (url.includes('/api/v1/auth/username-available')) return { available: true };
      if (url.endsWith('/api/v1/auth/register')) {
        return { user: { id: 'fresh-1', onboardedAt: null }, sessionToken: 'tok' };
      }
      if (url.endsWith('/api/v1/me')) return { user: freshMe() };
      return {};
    });
    renderAccount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Email' }));
    await user.type(screen.getByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.type(screen.getByLabelText('Username'), 'fresh_handle');
    // Deterministic gate: submit only after the debounced availability
    // check resolves — otherwise the form correctly refuses while checking.
    expect(await screen.findByText('That username is available.', {}, { timeout: 5000 })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('profile-stub')).toBeDefined();
  });

  it('passes axe with the email form open', async () => {
    const { container } = renderAccount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Email' }));
    expect(screen.getByLabelText('Username')).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), '/onboarding/account');
  });
});

describe('ProfileSetup screen', () => {
  function renderProfile() {
    return renderWithClient(
      <MemoryRouter initialEntries={['/onboarding/profile']}>
        <Routes>
          <Route path="/onboarding/profile" element={<ProfileSetup />} />
          <Route path="/onboarding/interests" element={<div>interests-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('requires the name and saves everything on Continue', { timeout: 30_000 }, async () => {
    setFreshAccount();
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url.endsWith('/api/v1/me/provider-profile')) return { providerProfile: { displayName: 'Jordan Lee' } };
      if (url.endsWith('/api/v1/me/profile')) return { profile: { bio: 'Hi.', phone: null, dob: null, location: null } };
      if (url.endsWith('/api/v1/me/onboarded')) return { user: { ...freshMe(), onboardedAt: new Date().toISOString() } };
      return {};
    });
    renderProfile();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Use at least 2 characters.')).toBeDefined();
    expect(seen.some((u) => u.endsWith('/api/v1/me/onboarded'))).toBe(false);
    await user.type(screen.getByLabelText('Full name'), 'Jordan Lee');
    await user.type(screen.getByLabelText(/Bio/), 'Hi.');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('interests-stub')).toBeDefined();
    expect(seen.some((u) => u.endsWith('/api/v1/me/provider-profile'))).toBe(true);
    expect(seen.some((u) => u.endsWith('/api/v1/me/onboarded'))).toBe(true);
  });

  it('Skip still requires the name but skips the rest', { timeout: 30_000 }, async () => {
    setFreshAccount();
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url.endsWith('/api/v1/me/provider-profile')) return { providerProfile: { displayName: 'Jordan Lee' } };
      if (url.endsWith('/api/v1/me/onboarded')) return { user: { ...freshMe(), onboardedAt: new Date().toISOString() } };
      return {};
    });
    renderProfile();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Use at least 2 characters.')).toBeDefined();
    await user.type(screen.getByLabelText('Full name'), 'Jordan Lee');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('interests-stub')).toBeDefined();
    expect(seen.some((u) => u.endsWith('/api/v1/me/profile'))).toBe(false);
  });

  it('passes axe', async () => {
    setFreshAccount();
    mockFetch(() => ({}));
    const { container } = renderProfile();
    expect(screen.getByLabelText('Full name')).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), '/onboarding/profile');
  });
});

describe('Interests screen', () => {
  function renderInterests() {
    return renderWithClient(
      <MemoryRouter initialEntries={['/onboarding/interests']}>
        <Routes>
          <Route path="/onboarding/interests" element={<Interests />} />
          <Route path="/sell/new" element={<div>sell-new-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('toggles chips, persists on Continue, and advances', async () => {
    setFreshAccount();
    renderInterests();
    const user = userEvent.setup();
    const eventChip = screen.getByRole('button', { name: 'Event' });
    expect(eventChip.getAttribute('aria-pressed')).toBe('false');
    await user.click(eventChip);
    expect(eventChip.getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('sell-new-stub')).toBeDefined();
    expect(sessionStorage.getItem('takeover.interests')).toBe(JSON.stringify(['Event']));
    expect(sessionStorage.getItem('takeover.welcomeBanner')).toBe('1');
  });

  it('Skip stores an empty selection', async () => {
    setFreshAccount();
    renderInterests();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('sell-new-stub')).toBeDefined();
    expect(sessionStorage.getItem('takeover.interests')).toBe(JSON.stringify([]));
  });

  it('passes axe', async () => {
    setFreshAccount();
    const { container } = renderInterests();
    expect(screen.getByText('What are you looking for?')).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), '/onboarding/interests');
  });
});

describe('Login screen', () => {
  function renderLogin(path = '/login') {
    return renderWithClient(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>home-stub</div>} />
          <Route path="/welcome" element={<div>welcome-stub</div>} />
          <Route path="*" element={<div>away-stub</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('signs in with email and honors ?redirect=', { timeout: 30_000 }, async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/v1/auth/login')) {
        return { user: { id: 'buyer-1' }, sessionToken: 'tok' };
      }
      if (url.endsWith('/api/v1/me')) {
        return { user: { ...meFixture(), onboardedAt: new Date().toISOString() } };
      }
      return {};
    });
    renderLogin('/login?redirect=/sell/new');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Password'), 'long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // ?redirect=/sell/new is outside this test router — the catch-all proves
    // the navigation left /login for the requested route.
    expect(await screen.findByText('away-stub')).toBeDefined();
  });

  it('shows the generic server message on failure and links to signup', { timeout: 30_000 }, async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/v1/auth/login')) {
        return err(401, 'UNAUTHENTICATED', 'Invalid email or password.');
      }
      return {};
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'a@b.c');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in with wallet' })).toBeDefined();
  });

  it('passes axe', async () => {
    const { container } = renderLogin();
    expect(screen.getByLabelText('Password')).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), '/login');
  });
});

describe('feed interests seeding', () => {
  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="loc">{`${location.pathname}${location.search}`}</div>;
  }

  it('applies the first stored interest once, then never again', { timeout: 30_000 }, async () => {
    sessionStorage.setItem('takeover.interests', JSON.stringify(['Event', 'Salon / service']));
    mockFetch(() => ({ slots: [], total: 0, limit: 12, offset: 0 }));
    renderWithClient(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <FeedSection pageSize={12} capped />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/nothing available right now/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toContain('category=Event');
    });
    expect(sessionStorage.getItem('takeover.interests')).toBeNull();
  });

  it('leaves an explicit ?category alone', { timeout: 30_000 }, async () => {
    sessionStorage.setItem('takeover.interests', JSON.stringify(['Event']));
    mockFetch(() => ({ slots: [], total: 0, limit: 12, offset: 0 }));
    renderWithClient(
      <MemoryRouter initialEntries={['/?category=Other']}>
        <LocationProbe />
        <FeedSection pageSize={12} capped />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/nothing available right now/i)).toBeDefined();
    expect(screen.getByTestId('loc').textContent).toContain('category=Other');
    // Unconsumed on this visit — an explicit filter always wins.
    expect(sessionStorage.getItem('takeover.interests')).not.toBeNull();
  });
});

describe('Product tour', () => {
  function setTourEligible(): void {
    useAuth.setState({
      status: 'authenticated',
      user: {
        id: 'buyer-1',
        walletAddress: 'NQ0700000000000000000000000000000000',
        role: 'buyer',
        status: 'active',
        onboardedAt: new Date().toISOString(),
        tourCompletedAt: null,
      },
      error: null,
      initialized: true,
    });
  }

  function setTourDone(): void {
    useAuth.setState({
      status: 'authenticated',
      user: {
        id: 'buyer-1',
        walletAddress: 'NQ0700000000000000000000000000000000',
        role: 'buyer',
        status: 'active',
        onboardedAt: new Date().toISOString(),
        tourCompletedAt: new Date().toISOString(),
      },
      error: null,
      initialized: true,
    });
  }

  // jsdom reports all-zero rects — stub a visible box per element.
  function stubRects(): void {
    const rect = {
      x: 16,
      y: 100,
      top: 100,
      left: 16,
      width: 300,
      height: 60,
      right: 316,
      bottom: 160,
      toJSON: () => ({}),
    };
    vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      rect as unknown as DOMRect,
    );
  }

  function tourDom(withCard: boolean): ReactNode {
    return (
      <div>
        <section id="openings" aria-labelledby="feed-heading">
          <h2 id="feed-heading">Available now</h2>
          {withCard ? <a href="/slot/1">Slot one</a> : null}
        </section>
        <nav aria-label="Primary">
          <a href="/sell" aria-label="Sell">
            Sell
          </a>
          <a href="/profile" aria-label="Profile">
            Profile
          </a>
        </nav>
      </div>
    );
  }

  it('resolveTourStops skips absent and hidden targets', () => {
    stubRects();
    const { unmount } = renderWithClient(<>{tourDom(true)}</>);
    expect(resolveTourStops(TOUR_STOPS, document).map((s) => s.id)).toEqual([
      'feed',
      'card',
      'sell',
      'profile',
    ]);
    unmount();
    renderWithClient(<>{tourDom(false)}</>);
    // No card link → the card stop is skipped, the rest resolve.
    expect(resolveTourStops(TOUR_STOPS, document).map((s) => s.id)).toEqual([
      'feed',
      'sell',
      'profile',
    ]);
  });

  it('walks all four stops with dialog semantics, then finishes', { timeout: 30_000 }, async () => {
    stubRects();
    let finished = 0;
    let skipped = 0;
    const { container } = renderWithClient(
      <>
        {tourDom(true)}
        <ProductTour
          stops={TOUR_STOPS}
          onFinish={() => {
            finished += 1;
          }}
          onSkip={() => {
            skipped += 1;
          }}
        />
      </>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('tour-title-feed');
    expect(screen.getByText('Your feed')).toBeDefined();
    expect(screen.getByText('1 of 4')).toBeDefined();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Openings open fast')).toBeDefined();
    expect(screen.getByText('2 of 4')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Release your own')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Your corner')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDefined();
    assertZeroCriticalOrSerious(await runAxe(container), 'product tour step');
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(finished).toBe(1);
    expect(skipped).toBe(0);
  });

  it('Skip tour button skips', async () => {
    stubRects();
    let skipped = 0;
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTour
          stops={TOUR_STOPS}
          onFinish={() => {}}
          onSkip={() => {
            skipped += 1;
          }}
        />
      </>,
    );
    const user = userEvent.setup();
    // getAllByRole DOM order: [0] backdrop catcher, [1] visible Skip.
    await user.click(screen.getAllByRole('button', { name: 'Skip tour' })[1]);
    expect(skipped).toBe(1);
  });

  it('backdrop tap skips', async () => {
    stubRects();
    let skipped = 0;
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTour
          stops={TOUR_STOPS}
          onFinish={() => {}}
          onSkip={() => {
            skipped += 1;
          }}
        />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Skip tour' })[0]);
    expect(skipped).toBe(1);
  });

  it('Escape skips', async () => {
    stubRects();
    let skipped = 0;
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTour
          stops={TOUR_STOPS}
          onFinish={() => {}}
          onSkip={() => {
            skipped += 1;
          }}
        />
      </>,
    );
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(skipped).toBe(1);
  });

  it('completes silently when nothing resolves', async () => {
    let finished = 0;
    const noop = (): void => {};
    renderWithClient(
      <ProductTour
        stops={TOUR_STOPS}
        onFinish={() => {
          finished += 1;
        }}
        onSkip={noop}
      />,
    );
    // Empty document body section — no feed, no nav.
    await waitFor(() => {
      expect(finished).toBe(1);
    });
    expect(screen.queryByTestId('product-tour')).toBeNull();
  });

  it('host shows nothing for guests, done users, or fresh accounts', async () => {
    stubRects();
    // Guest.
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTourHost />
      </>,
    );
    expect(screen.queryByTestId('product-tour')).toBeNull();

    // Tour already done.
    setTourDone();
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTourHost />
      </>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('product-tour')).toBeNull();
    });

    // Fresh account (not onboarded) — tour waits for onboarding.
    setFreshAccount();
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTourHost />
      </>,
    );
    expect(screen.queryByTestId('product-tour')).toBeNull();
  });

  it('host runs the tour once for eligible users and persists on finish', { timeout: 30_000 }, async () => {
    stubRects();
    let posts = 0;
    mockFetch((url) => {
      if (url.endsWith('/api/v1/me/tour-completed')) {
        posts += 1;
        return {
          user: {
            ...meFixture(),
            onboardedAt: new Date().toISOString(),
            tourCompletedAt: new Date().toISOString(),
          },
        };
      }
      return {};
    });
    setTourEligible();
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTourHost />
      </>,
    );
    // 600ms delay, then the overlay appears on step 1.
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(dialog).toBeDefined();
    expect(screen.getByText('Your feed')).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Skip tour' })[1]);
    expect(posts).toBe(1);
    await waitFor(() => {
      expect(screen.queryByTestId('product-tour')).toBeNull();
    });
    // Store user now carries the completion — no second run.
    expect(useAuth.getState().user?.tourCompletedAt).not.toBeNull();
  });

  it('markTourCompleted failures still unmount (retry next visit)', { timeout: 30_000 }, async () => {
    stubRects();
    mockFetch((url) => {
      if (url.endsWith('/api/v1/me/tour-completed')) {
        return err(500, 'INTERNAL_ERROR', 'Something went wrong.');
      }
      return {};
    });
    setTourEligible();
    renderWithClient(
      <>
        {tourDom(true)}
        <ProductTourHost />
      </>,
    );
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Skip tour' })[1]);
    await waitFor(() => {
      expect(screen.queryByTestId('product-tour')).toBeNull();
    });
    // Column still NULL → eligible again next Home visit.
    expect(useAuth.getState().user?.tourCompletedAt).toBeNull();
  });
});
