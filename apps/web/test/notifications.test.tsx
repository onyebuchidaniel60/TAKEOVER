// @vitest-environment jsdom
// Notifications UI — badge visibility, newest-first list,
// mark-all-read clearing the badge, tap-to-read navigation.
// Hamburger-drawer move: the badge lives on the Notifications item
// inside the drawer (plus a numberless dot on the menu button); the
// list renders at /notifications via NotificationsPage; the top row
// holds only brand + menu button + wallet.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationsSection from '../src/components/NotificationsSection';
import TopBar from '../src/components/TopBar';
import type { NotificationView } from '../src/lib/slots';
import NotificationsPage from '../src/routes/NotificationsPage';
import Profile from '../src/routes/Profile';
import { useAuth } from '../src/store/auth';
import { useNotifications } from '../src/store/notifications';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
  useNotifications.setState({ unread: null });
});

function note(overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'note-1',
    type: 'slot_delivered',
    entity_type: 'claim',
    entity_id: 'claim-1',
    title: 'Marked delivered',
    body: 'Your claim was marked delivered.',
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }): {
  seen: { url: string; init?: RequestInit }[];
} {
  const seen: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      seen.push({ url: u, init });
      const { status, body } = handler(u, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }) as typeof fetch,
  );
  return { seen };
}

function authAsBuyer(): void {
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u-1', walletAddress: 'NQ3200000000000000000000000000000000', role: 'buyer', status: 'active' },
    error: null,
    initialized: true,
  });
}

describe('TopBar navigation drawer', () => {
  it('keeps the top row to brand + menu; the four links live in the drawer', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [], unreadCount: 0 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'TAKEOVER home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    // No inline nav links on the top row (Profile overflow fix).
    expect(screen.queryByRole('link', { name: 'Sell' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Claims' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(await screen.findByRole('link', { name: 'Sell' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Claims' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Profile' })).toBeTruthy();
  });

  it('shows the count on the drawer item plus a dot on the menu button when unread > 0', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [], unreadCount: 3 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Open menu, 3 unread notifications')).toBeTruthy();
    // Terracotta dot on the hamburger, no number while the drawer is closed.
    expect(container.querySelector('button span.rounded-full')).toBeTruthy();
    await user.click(screen.getByLabelText('Open menu, 3 unread notifications'));
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeTruthy();
  });

  it('hides the count and the dot when unread is 0', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [], unreadCount: 0 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    );
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    expect(container.querySelector('button span.rounded-full')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('tapping the drawer link navigates to /notifications', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [], unreadCount: 0 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TopBar />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('link', { name: 'Notifications' }));
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
  });

  it('the list renders on the notifications page', async () => {
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [note()], unreadCount: 1 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(await screen.findByText('Marked delivered')).toBeTruthy();
  });

  it('Profile no longer renders the notifications section', async () => {
    authAsBuyer();
    stubFetch((url) => {
      if (url === '/api/v1/me') {
        return {
          status: 200,
          body: {
            data: {
              user: {
                id: 'u-1',
                walletAddress: 'NQ3200000000000000000000000000000000',
                role: 'buyer',
                status: 'active',
                hasProviderProfile: false,
                providerProfile: null,
              },
            },
            requestId: 't',
          },
        };
      }
      if (url.startsWith('/api/v1/me/slots')) {
        return { status: 200, body: { data: { slots: [], total: 0, limit: 1, offset: 0 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Profile' });
    await waitFor(() => expect(screen.queryByLabelText(/loading/i)).toBeNull());
    expect(screen.queryByLabelText('Notifications')).toBeNull();
    expect(screen.queryByRole('button', { name: /mark all read/i })).toBeNull();
  });
});

describe('NotificationsSection', () => {
  it('renders newest first with unread dots', async () => {
    const older = note({ id: 'old', title: 'Slot funded', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = note({ id: 'new', title: 'Marked delivered', created_at: '2026-06-01T00:00:00.000Z' });
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return {
          status: 200,
          body: { data: { notifications: [newer, older], unreadCount: 2 }, requestId: 't' },
        };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    const { container } = render(
      <MemoryRouter>
        <NotificationsSection />
      </MemoryRouter>,
    );
    await screen.findByText('Marked delivered');
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Marked delivered');
    expect(items[1]?.textContent).toContain('Slot funded');
  });

  it('mark-all-read clears the badge', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    useNotifications.setState({ unread: 2 });
    let unread = 2;
    const { seen } = stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications/read-all')) {
        unread = 0;
        return { status: 200, body: { data: { marked: 2 }, requestId: 't' } };
      }
      if (url.includes('/api/v1/me/notifications')) {
        return {
          status: 200,
          body: { data: { notifications: [note(), note({ id: 'note-2' })], unreadCount: unread }, requestId: 't' },
        };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <TopBar />
        <NotificationsSection />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /mark all read/i });
    await user.click(screen.getByRole('button', { name: /mark all read/i }));
    await waitFor(() => expect(useNotifications.getState().unread).toBe(0));
    expect(seen.some((s) => s.url.includes('/read-all') && s.init?.method === 'POST')).toBe(true);
    expect(screen.queryByLabelText(/unread notifications/)).toBeNull();
  });

  it('tapping a notification fires the read call and navigates to the claim', async () => {
    const user = userEvent.setup();
    authAsBuyer();
    const { seen } = stubFetch((url) => {
      if (url.includes('/notifications/note-1/read')) {
        return {
          status: 200,
          body: { data: { notification: note({ read_at: new Date().toISOString() }) }, requestId: 't' },
        };
      }
      if (url.includes('/api/v1/me/notifications')) {
        return { status: 200, body: { data: { notifications: [note()], unreadCount: 1 }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route
            path="/profile"
            element={
              <>
                <TopBar />
                <NotificationsSection />
              </>
            }
          />
          <Route path="/claim/:claimId" element={<p>claim page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByText('Marked delivered'));
    expect(seen.some((s) => s.url.includes('/notifications/note-1/read') && s.init?.method === 'POST')).toBe(true);
    expect(await screen.findByText('claim page')).toBeTruthy();
  });

  it('a provider funding notice links to the slot manage page', async () => {
    authAsBuyer();
    stubFetch((url) => {
      if (url.includes('/api/v1/me/notifications')) {
        return {
          status: 200,
          body: {
            data: {
              notifications: [note({ id: 'n2', type: 'slot_funded', entity_type: 'slot', entity_id: 'slot-9', title: 'Slot funded' })],
              unreadCount: 1,
            },
            requestId: 't',
          },
        };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    render(
      <MemoryRouter>
        <NotificationsSection />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: /slot funded/i });
    expect(link.getAttribute('href')).toBe('/sell/slot-9');
  });
});
