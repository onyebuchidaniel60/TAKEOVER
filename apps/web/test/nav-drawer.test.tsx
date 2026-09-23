// @vitest-environment jsdom
// Hamburger navigation drawer: closed top row, open/close triggers,
// navigation, focus trap + return, badge dot, admin gating, panel width.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<><TopBar /><p>home page</p></>} />
        <Route path="/sell" element={<><TopBar /><p>sell page</p></>} />
        <Route path="/claims" element={<><TopBar /><p>claims page</p></>} />
        <Route path="/notifications" element={<><TopBar /><p>notifications page</p></>} />
        <Route path="/profile" element={<><TopBar /><p>profile page</p></>} />
        <Route path="/admin" element={<><TopBar /><p>admin page</p></>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /open menu/i }));
  await screen.findByRole('navigation', { name: 'Site menu' });
}

describe('nav drawer chrome', () => {
  it('renders the hamburger with disclosure wiring while closed', async () => {
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('site-nav');
    expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
  });

  it('opens a left panel sized for mobile, not full width', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    const nav = screen.getByRole('navigation', { name: 'Site menu' });
    expect(nav.id).toBe('site-nav');
    expect(nav.className).toContain('w-[280px]');
    expect(nav.className).toContain('max-w-[85vw]');
    expect(nav.className).toContain('ease-drawer');
    expect(nav.className).toContain('duration-panel');
    // Opaque elevated panel — never translucent.
    expect(nav.className).toContain('bg-surface');
    expect(nav.className).toContain('border-r');
    expect(nav.className).not.toMatch(/bg-surface\/|bg-opacity|backdrop-blur/);
  });

  it('renders the drawer outside the header so fixed positioning hits the viewport', async () => {
    // Regression: the header's backdrop-blur makes it the containing
    // block for fixed descendants. A fixed drawer inside the header
    // sizes to the header strip — panel paints header-tall while the
    // items overflow below it with no background (transparent drawer).
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    const header = document.querySelector('header') as HTMLElement;
    const nav = screen.getByRole('navigation', { name: 'Site menu' });
    expect(header.contains(nav)).toBe(false);
    expect(nav.parentElement?.className).toContain('fixed');
    expect(nav.parentElement?.className).toContain('inset-0');
  });

  it('tapping an item closes the drawer and navigates', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('link', { name: 'Sell' }));
    expect(await screen.findByText('sell page')).toBeTruthy();
    expect(screen.getByRole('button', { name: /open menu/i }).getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    });
  });

  it('Escape closes the drawer and returns focus to the hamburger', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/open menu/i);
  });

  it('outside tap on the backdrop closes the drawer', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    await openDrawer(user);
    const backdrop = container.querySelector('[data-testid="nav-backdrop"]');
    expect(backdrop).toBeTruthy();
    expect(backdrop?.className).toContain('bg-bg/60');
    await user.click(backdrop as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    });
  });

  it('the drawer close button dismisses without navigating', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(await screen.findByText('home page')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    });
  });

  it('traps Tab inside the drawer and wraps at the ends', async () => {
    const user = userEvent.setup();
    authAs('buyer');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    const close = screen.getByRole('button', { name: 'Close menu' });
    close.focus();
    // Close + 4 links: four tabs land on Profile, the fifth wraps to Close.
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Sell');
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Profile');
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close menu');
    // Shift+Tab from the first control wraps to the last link.
    await user.tab({ shift: true });
    expect(document.activeElement?.textContent).toContain('Profile');
  });

  it('shows the hamburger dot only while unread > 0', async () => {
    authAs('buyer');
    stubFetch(3);
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    await screen.findByLabelText('Open menu, 3 unread notifications');
    expect(container.querySelector('button span.rounded-full')).toBeTruthy();
    unmount();
    cleanup();
    useNotifications.setState({ unread: null });
    stubFetch(0);
    const second = render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(second.container.querySelector('button span.rounded-full')).toBeNull();
  });

  it('gates the Admin item on the admin role', async () => {
    const user = userEvent.setup();
    authAs('admin');
    stubFetch(0);
    renderShell();
    await openDrawer(user);
    expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Site menu' })).toBeNull();
    });
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u-1', walletAddress: 'NQ3200000000000000000000000000000000', role: 'buyer', status: 'active' },
      error: null,
      initialized: true,
    });
    await openDrawer(user);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});
