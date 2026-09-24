// @vitest-environment jsdom
// Floating pill bottom nav (D2): header holds brand + wallet only,
// five icon-only pill items (icon-only: even active-only labels bleed
// at 320px — measured), active lime pill, unread dot, navigation.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BottomNav from '../src/components/BottomNav';
import TopBar from '../src/components/TopBar';
import { useAuth } from '../src/store/auth';
import { useNotifications } from '../src/store/notifications';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
  useNotifications.setState({ unread: null });
});

function stubFetch(unreadCount: number): void {
  vi.stubGlobal(
    'fetch',
    (async (url: unknown) => {
      const u = String(url);
      const body = u.includes('/api/v1/me/notifications')
        ? { data: { notifications: [], unreadCount }, requestId: 't' }
        : { data: {}, requestId: 't' };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }) as typeof fetch,
  );
}

function authAs(role: string): void {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u-1', walletAddress: 'NQ3200000000000000000000000000000000', role, status: 'active' },
    error: null,
    initialized: true,
  });
}

function renderShell(initial = '/'): void {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<><TopBar /><BottomNav /><p>home page</p></>} />
        <Route path="/openings" element={<><TopBar /><BottomNav /><p>openings page</p></>} />
        <Route path="/sell/*" element={<><TopBar /><BottomNav /><p>sell page</p></>} />
        <Route path="/sell/new" element={<><TopBar /><BottomNav /><p>sell new page</p></>} />
        <Route path="/claims" element={<><TopBar /><BottomNav /><p>claims page</p></>} />
        <Route path="/claim/:claimId" element={<><TopBar /><BottomNav /><p>claim page</p></>} />
        <Route path="/notifications" element={<><TopBar /><BottomNav /><p>notifications page</p></>} />
        <Route path="/profile" element={<><TopBar /><BottomNav /><p>profile page</p></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('header chrome', () => {
  it('holds brand + wallet only: no menu button, no inline nav links', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.getByRole('link', { name: 'TAKEOVER home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
  });

  it('is a 56px sticky row on the deep base', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    const header = document.querySelector('header') as HTMLElement;
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('bg-bg');
    expect(header.querySelector('div')?.className).toContain('h-14');
  });
});

describe('pill bottom nav', () => {
  it('renders five items in order inside a fixed safe-area pill', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav.className).toContain('fixed');
    expect(nav.className).toContain('safe-area-inset-bottom');
    const links = ['Home', 'Sell', 'Claims', 'Notifications', 'Profile'].map((name) =>
      screen.getByRole('link', { name }),
    );
    expect(links).toHaveLength(5);
    const pill = nav.firstElementChild as HTMLElement;
    expect(pill.className).toContain('rounded-pill');
    expect(pill.className).toContain('bg-surface');
  });

  it('marks the active item with aria-current and the lime pill (icon-only)', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell('/sell');
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    const sell = screen.getByRole('link', { name: 'Sell' });
    expect(sell.getAttribute('aria-current')).toBe('page');
    expect(sell.innerHTML).toContain('bg-accent');
    // Icon-only at every width: no visible label text anywhere in the pill.
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav.textContent ?? '').not.toContain('Notifications');
  });

  it('activates Home exactly on / (never on /slot/* or /claim/*)', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell('/');
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    useNotifications.setState({ unread: null });
    render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<BottomNav />} />
        </Routes>
      </MemoryRouter>,
    );
    for (const name of ['Home', 'Sell', 'Claims', 'Notifications', 'Profile']) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBeNull();
    }
  });

  it('treats /openings as the Home surface', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell('/openings');
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText('openings page')).toBeTruthy();
  });

  it('shows the numberless lime dot on Notifications only while unread > 0', async () => {
    authAs('buyer');
    stubFetch(3);
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeTruthy();
    // Lime dot, no number on the pill.
    const dot = container.querySelector('a span span.rounded-full');
    expect(dot).toBeTruthy();
    expect(dot?.textContent).toBe('');
    unmount();
    cleanup();
    useNotifications.setState({ unread: null });
    stubFetch(0);
    authAs('buyer');
    const second = render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(second.container.querySelector('a span span.rounded-full')).toBeNull();
  });

  it('every item meets the 44px touch target in both dimensions', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    for (const name of ['Home', 'Sell', 'Claims', 'Notifications', 'Profile']) {
      const link = screen.getByRole('link', { name });
      // Structural proxy (jsdom has no layout): h-12 × min-w-[48px].
      // The audit script measures real boxes in Chromium.
      expect(link.className).toContain('h-12');
      expect(link.className).toContain('min-w-[48px]');
    }
  });

  it('tapping an item navigates', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    await user.click(screen.getByRole('link', { name: 'Claims' }));
    expect(await screen.findByText('claims page')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Claims' }).getAttribute('aria-current')).toBe('page');
  });

  it('carries no Admin item for any role (admin routes stay URL-addressed)', async () => {
    authAs('admin');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});
