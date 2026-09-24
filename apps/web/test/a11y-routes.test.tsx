// @vitest-environment jsdom
// Automated a11y: axe-core over every route in a loaded state.
// Zero critical/serious violations allowed; moderate/minor are printed.
// Color-contrast is excluded here (jsdom cannot
// compute styles) and measured separately with exact palette math.
// Readiness waits for the loading skeleton to LEAVE the
// DOM (MutationObserver-driven) instead of sleeping a fixed 50ms — no
// elapsed-time assumption, so CPU contention can no longer beat the wait.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RequireAdmin from '../src/components/RequireAdmin';
import RequireAuth from '../src/components/RequireAuth';
import BottomNav from '../src/components/BottomNav';
import TopBar from '../src/components/TopBar';
import AdminAudit from '../src/routes/admin/AdminAudit';
import AdminDashboard from '../src/routes/admin/AdminDashboard';
import AdminPaymentReviews from '../src/routes/admin/AdminPaymentReviews';
import AdminReports from '../src/routes/admin/AdminReports';
import AdminSlots from '../src/routes/admin/AdminSlots';
import AdminUsers from '../src/routes/admin/AdminUsers';
import ClaimDetailPage from '../src/routes/ClaimDetailPage';
import ClaimsPage from '../src/routes/ClaimsPage';
import Home from '../src/routes/Home';
import Openings from '../src/routes/Openings';
import NotFound from '../src/routes/NotFound';
import NotificationsPage from '../src/routes/NotificationsPage';
import Profile from '../src/routes/Profile';
import Sell from '../src/routes/Sell';
import SellDetail from '../src/routes/SellDetail';
import SellNew from '../src/routes/SellNew';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import { useNotifications } from '../src/store/notifications';
import {
  assertZeroCriticalOrSerious,
  claimFixture,
  emptyCounts,
  err,
  intentFixture,
  meFixture,
  mockFetch,
  pendingForever,
  runAxe,
  setAdmin,
  setBuyer,
  setGuest,
  slotFixture,
  type AxeTriage,
} from './a11y-helpers';

const triageNotes: { route: string; moderate: number; minor: number }[] = [];

function renderAt(path: string, route: string, element: React.ReactNode): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<>{element}</>} />
      </Routes>
    </MemoryRouter>,
  );
  return container;
}

/**
 * Deterministic page readiness: resolves when the loading skeleton leaves
 * the DOM (every fetching route renders it first). Resolves immediately
 * when no skeleton is present (synchronously rendered routes like /sell/new
 * and the 404 page). A single polled condition — no elapsed-time assumption
 * and no existence prerequisite, so neither CPU contention nor render speed
 * can beat or break the wait.
 */
async function awaitLoaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByLabelText(/loading/i)).toBeNull();
  });
}

async function checkAxe(route: string, container: HTMLElement): Promise<void> {
  const triage: AxeTriage = await runAxe(container);
  if (triage.moderate.length > 0 || triage.minor.length > 0) {
    triageNotes.push({ route, moderate: triage.moderate.length, minor: triage.minor.length });
    console.log(
      `a11y triage ${route}: ${triage.moderate.length} moderate, ${triage.minor.length} minor`,
    );
    for (const v of [...triage.moderate, ...triage.minor] as { id?: string; impact?: string; description?: string }[]) {
      console.log(`  - [${v.impact}] ${v.id}: ${v.description}`);
    }
  }
  assertZeroCriticalOrSerious(triage, route);
}

function slotsList(total = 2): Record<string, unknown> {
  return {
    slots: [slotFixture(), slotFixture({ id: 'slot-2', title: 'Yoga at sunrise' })],
    total,
    limit: 20,
    offset: 0,
  };
}

function notificationsList(): Record<string, unknown> {
  return {
    notifications: [
      {
        id: 'note-1',
        type: 'slot_delivered',
        entity_type: 'claim',
        entity_id: 'claim-1',
        title: 'Marked delivered',
        body: 'Your claim was marked delivered.',
        read_at: null,
        created_at: new Date().toISOString(),
      },
    ],
    unreadCount: 1,
  };
}

describe('axe on consumer routes', () => {
  it('/ renders without critical/serious violations', async () => {
    setGuest();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots')) return slotsList();
      return undefined;
    });
    const container = renderAt('/', '/', <Home />);
    await awaitLoaded();
    await checkAxe('/', container);
  });

  it('/openings renders without critical/serious violations', async () => {
    setGuest();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots')) return slotsList();
      return undefined;
    });
    const container = renderAt('/openings', '/openings', <Openings />);
    await awaitLoaded();
    await checkAxe('/openings', container);
  });

  it('/slot/:id renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await awaitLoaded();
    await checkAxe('/slot/:id', container);
    expect(container.textContent).toContain('Table for two');
  });

  it('/claim/:id renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.includes('/payment-intent')) return { intent: intentFixture(), claim: claimFixture(), slot: slotFixture() };
      if (url.startsWith('/api/v1/claims/')) return { claim: claimFixture(), slot: slotFixture() };
      return undefined;
    });
    const container = renderAt(
      '/claim/claim-1',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/claim/:id', container);
  });

  it('/claims renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/me/claims')) {
        return { claims: [claimFixture(), claimFixture('paid', { id: 'c2' })], total: 2, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/claims',
      '/claims',
      <RequireAuth>
        <ClaimsPage />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/claims', container);
  });

  it('/sell renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/me/slots/')) return { claims: [], counts: emptyCounts() };
      if (url.startsWith('/api/v1/me/slots')) {
        return { slots: [{ ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000' }], total: 1, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/sell',
      '/sell',
      <RequireAuth>
        <Sell />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell', container);
  });

  it('/sell/new renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch(() => undefined);
    const container = renderAt(
      '/sell/new',
      '/sell/new',
      <RequireAuth>
        <SellNew />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell/new', container);
  });

  it('/sell/:id renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) {
        return { slot: { ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000', status: 'draft' } };
      }
      return undefined;
    });
    const container = renderAt(
      '/sell/slot-1',
      '/sell/:slotId',
      <RequireAuth>
        <SellDetail />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell/:id', container);
  });

  it('/profile renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: meFixture() };
      if (url.startsWith('/api/v1/me/slots')) return { slots: [], total: 0, limit: 1, offset: 0 };
      if (url === '/api/v1/me/notifications') {
        return {
          notifications: [
            {
              id: 'note-1',
              type: 'slot_delivered',
              entity_type: 'claim',
              entity_id: 'claim-1',
              title: 'Marked delivered',
              body: 'Your claim was marked delivered.',
              read_at: null,
              created_at: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/profile',
      '/profile',
      <RequireAuth>
        <Profile />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/profile', container);
  });

  it('/notifications renders without critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me/notifications') return notificationsList();
      return undefined;
    });
    const container = renderAt(
      '/notifications',
      '/notifications',
      <RequireAuth>
        <NotificationsPage />
      </RequireAuth>,
    );
    // The section's loading copy carries no aria-label, so awaitLoaded
    // would resolve early: wait for the loaded list instead.
    await screen.findByText('Marked delivered');
    await checkAxe('/notifications', container);
  });

  it('unknown path renders the 404 page without critical/serious violations', async () => {
    setGuest();
    mockFetch(() => undefined);
    const container = renderAt('/nope', '*', <NotFound />);
    await checkAxe('404', container);
    expect(container.textContent).toContain('doesn’t exist');
  });
});

function adminReport(): Record<string, unknown> {
  return {
    id: 'report-1',
    reason: 'misleading_listing',
    details: 'Looks off.',
    status: 'open',
    created_at: new Date().toISOString(),
    reviewed_at: null,
    resolution_notes: null,
    resolved_by_user_id: null,
    reporter: { id: 'u1', walletDisplay: 'NQ07…0000' },
    slot: { id: 'slot-1', title: 'Table for two — tonight', status: 'published' },
    targetUser: null,
  };
}

describe('axe on admin routes', () => {
  it('/admin renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) return { reports: [], total: 0, limit: 1, offset: 0 };
      if (url.startsWith('/api/v1/admin/payment-reviews')) return { reviews: [], total: 0, limit: 1, offset: 0 };
      if (url.startsWith('/api/v1/admin/audit-events')) return { events: [], total: 0, limit: 1, offset: 0 };
      return undefined;
    });
    const container = renderAt(
      '/admin',
      '/admin',
      <RequireAdmin>
        <AdminDashboard />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin', container);
  });

  it('/admin/reports renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 20, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/reports',
      '/admin/reports',
      <RequireAdmin>
        <AdminReports />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/reports', container);
  });

  it('/admin/payment-reviews renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/payment-reviews')) {
        return {
          reviews: [
            {
              claim: { id: 'claim-1', status: 'payment_review', buyerWallet: 'NQ0700000000000000000000000000000000', claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              slot: { id: 'slot-1', title: 'Table for two', price_usdt: '150000', payout_wallet: 'NQ3200000000000000000000000000000000' },
              intent: { id: 'intent-1', expected_amount_nim: '150000', expected_recipient: 'NQ32', expected_sender: 'NQ07', expected_data: 'TAKEOVER:v1:claim-1', tx_hash: null, submitted_at: null },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/payment-reviews',
      '/admin/payment-reviews',
      <RequireAdmin>
        <AdminPaymentReviews />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/payment-reviews', container);
  });

  it('/admin/users renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/users',
      '/admin/users',
      <RequireAdmin>
        <AdminUsers />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/users', container);
  });

  it('/admin/slots renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 50, offset: 0 };
      }
      if (url.startsWith('/api/v1/admin/payment-reviews')) {
        return { reviews: [], total: 0, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/slots',
      '/admin/slots',
      <RequireAdmin>
        <AdminSlots />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/slots', container);
  });

  it('/admin/audit renders without critical/serious violations', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/audit-events')) {
        return {
          events: [
            { id: 'e1', actor: { id: 'u1', walletDisplay: 'NQ07…0000' }, event_type: 'slot.published', entity_type: 'slot', entity_id: 'slot-1', metadata: { from: 'draft', to: 'published' }, created_at: new Date().toISOString(), request_id: 'r1' },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/audit',
      '/admin/audit',
      <RequireAdmin>
        <AdminAudit />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/audit', container);
  });
});

describe('axe on error states', () => {
  it('/slot/:id error state has no critical/serious violations', async () => {
    setGuest();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await awaitLoaded();
    expect(container.textContent).toContain('Couldn’t load this page');
    await checkAxe('/slot/:id error', container);
  });

  it('dialogs have no critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await awaitLoaded();
    const reportButton = screen.getByRole('button', { name: /report this opening/i });
    await user.click(reportButton);
    await checkAxe('report dialog', container);
  });
});

describe('axe on slot detail states', () => {
  it('/slot/:id loading skeleton has no critical/serious violations', async () => {
    setBuyer();
    mockFetch(() => pendingForever());
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByLabelText(/loading slot details/i);
    await checkAxe('/slot/:id loading', container);
  });

  it('/slot/:id not-found has no critical/serious violations', async () => {
    setGuest();
    mockFetch(() => err(404, 'NOT_FOUND', 'Slot not found.'));
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByText(/no longer available/i);
    await screen.findByRole('link', { name: /back to feed/i });
    await checkAxe('/slot/:id not-found', container);
  });

  it('/slot/:id own-slot view has no critical/serious violations', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.endsWith('/ownership')) return { isOwner: true };
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByText('This is your opening.');
    expect(screen.queryByRole('button', { name: /claim this slot/i })).toBeNull();
    await checkAxe('/slot/:id own-slot', container);
  });

  it('/slot/:id sticky CTA sits in a fixed above-nav container', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.endsWith('/ownership')) return { isOwner: false };
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    const button = await screen.findByRole('button', { name: /claim this slot/i });
    const fixed = button.closest('div.fixed');
    expect(fixed?.className).toContain('bottom-[calc(env(safe-area-inset-bottom,0px)+90px)]');
    expect(fixed?.className).toContain('z-30');
  });
});

// Pill nav shell: header + pill + page is axe-clean with the unread dot
// showing and with each nav item active in turn.
function renderShell(path = '/'): HTMLElement {
  useNotifications.setState({ unread: null });
  setBuyer();
  mockFetch((url) => {
    if (url === '/api/v1/me/notifications') return { notifications: [], unreadCount: 3 };
    return undefined;
  });
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
      <main>
        <h1>Shell page</h1>
      </main>
      <BottomNav />
    </MemoryRouter>,
  );
  return container;
}

async function awaitUnread(): Promise<void> {
  await waitFor(() => {
    expect(useNotifications.getState().unread).toBe(3);
  });
}

describe('axe on the pill nav shell', () => {
  it('shell chrome has no critical/serious violations', async () => {
    const container = renderShell();
    await awaitUnread();
    await checkAxe('shell chrome', container);
  });

  it('shell with the unread dot has no critical/serious violations', async () => {
    const container = renderShell();
    await awaitUnread();
    expect(screen.getByLabelText('Notifications, 3 unread')).toBeTruthy();
    await checkAxe('shell unread dot', container);
  });

  for (const [path, name] of [
    ['/sell', 'Sell'],
    ['/claims', 'Claims'],
    ['/notifications', 'Notifications'],
    ['/profile', 'Profile'],
  ]) {
    it(`shell with ${name} active has no critical/serious violations`, async () => {
      const container = renderShell(path);
      await awaitUnread();
      // Regex: the Notifications label carries the unread count suffix.
      expect(screen.getByRole('link', { name: new RegExp(name, 'i') }).getAttribute('aria-current')).toBe(
        'page',
      );
      await checkAxe(`shell ${name} active`, container);
    });
  }
});

// Dark-only since Phase 1: the `dark` class is inert (no darkMode
// switch, no `dark:` variants generated), so this block re-asserts the
// same structural coverage on the single theme. color-contrast stays
// palette-math (see the phase report); axe asserts the structural half
// (names, roles, focus, regions).
describe('axe on routes (dark-only re-assertion)', () => {
  beforeEach(() => {
    document.documentElement.classList.add('dark');
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('/ renders without critical/serious violations (dark)', async () => {
    setGuest();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots')) return slotsList();
      return undefined;
    });
    const container = renderAt('/', '/', <Home />);
    await awaitLoaded();
    await checkAxe('/ (dark)', container);
  });

  it('/openings renders without critical/serious violations (dark)', async () => {
    setGuest();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots')) return slotsList();
      return undefined;
    });
    const container = renderAt('/openings', '/openings', <Openings />);
    await awaitLoaded();
    await checkAxe('/openings (dark)', container);
  });

  it('/slot/:id renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await awaitLoaded();
    await checkAxe('/slot/:id (dark)', container);
    expect(container.textContent).toContain('Table for two');
  });

  it('/claim/:id renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.includes('/payment-intent')) return { intent: intentFixture(), claim: claimFixture(), slot: slotFixture() };
      if (url.startsWith('/api/v1/claims/')) return { claim: claimFixture(), slot: slotFixture() };
      return undefined;
    });
    const container = renderAt(
      '/claim/claim-1',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/claim/:id (dark)', container);
  });

  it('/claims renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/me/claims')) {
        return { claims: [claimFixture(), claimFixture('paid', { id: 'c2' })], total: 2, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/claims',
      '/claims',
      <RequireAuth>
        <ClaimsPage />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/claims (dark)', container);
  });

  it('/sell renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/me/slots/')) return { claims: [], counts: emptyCounts() };
      if (url.startsWith('/api/v1/me/slots')) {
        return { slots: [{ ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000' }], total: 1, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/sell',
      '/sell',
      <RequireAuth>
        <Sell />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell (dark)', container);
  });

  it('/sell/new renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch(() => undefined);
    const container = renderAt(
      '/sell/new',
      '/sell/new',
      <RequireAuth>
        <SellNew />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell/new (dark)', container);
  });

  it('/sell/:id renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) {
        return { slot: { ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000', status: 'draft' } };
      }
      return undefined;
    });
    const container = renderAt(
      '/sell/slot-1',
      '/sell/:slotId',
      <RequireAuth>
        <SellDetail />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/sell/:id (dark)', container);
  });

  it('/profile renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: meFixture() };
      if (url.startsWith('/api/v1/me/slots')) return { slots: [], total: 0, limit: 1, offset: 0 };
      if (url === '/api/v1/me/notifications') {
        return {
          notifications: [
            {
              id: 'note-1',
              type: 'slot_delivered',
              entity_type: 'claim',
              entity_id: 'claim-1',
              title: 'Marked delivered',
              body: 'Your claim was marked delivered.',
              read_at: null,
              created_at: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/profile',
      '/profile',
      <RequireAuth>
        <Profile />
      </RequireAuth>,
    );
    await awaitLoaded();
    await checkAxe('/profile (dark)', container);
  });

  it('/notifications renders without critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url === '/api/v1/me/notifications') return notificationsList();
      return undefined;
    });
    const container = renderAt(
      '/notifications',
      '/notifications',
      <RequireAuth>
        <NotificationsPage />
      </RequireAuth>,
    );
    // Same early-resolve guard as the light-mode test above.
    await screen.findByText('Marked delivered');
    await checkAxe('/notifications (dark)', container);
  });

  it('unknown path renders the 404 page without critical/serious violations (dark)', async () => {
    setGuest();
    mockFetch(() => undefined);
    const container = renderAt('/nope', '*', <NotFound />);
    await checkAxe('404 (dark)', container);
    expect(container.textContent).toContain('doesn’t exist');
  });

  it('/admin renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) return { reports: [], total: 0, limit: 1, offset: 0 };
      if (url.startsWith('/api/v1/admin/payment-reviews')) return { reviews: [], total: 0, limit: 1, offset: 0 };
      if (url.startsWith('/api/v1/admin/audit-events')) return { events: [], total: 0, limit: 1, offset: 0 };
      return undefined;
    });
    const container = renderAt(
      '/admin',
      '/admin',
      <RequireAdmin>
        <AdminDashboard />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin (dark)', container);
  });

  it('/admin/reports renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 20, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/reports',
      '/admin/reports',
      <RequireAdmin>
        <AdminReports />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/reports (dark)', container);
  });

  it('/admin/payment-reviews renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/payment-reviews')) {
        return {
          reviews: [
            {
              claim: { id: 'claim-1', status: 'payment_review', buyerWallet: 'NQ0700000000000000000000000000000000', claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              slot: { id: 'slot-1', title: 'Table for two', price_usdt: '150000', payout_wallet: 'NQ3200000000000000000000000000000000' },
              intent: { id: 'intent-1', expected_amount_nim: '150000', expected_recipient: 'NQ32', expected_sender: 'NQ07', expected_data: 'TAKEOVER:v1:claim-1', tx_hash: null, submitted_at: null },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/payment-reviews',
      '/admin/payment-reviews',
      <RequireAdmin>
        <AdminPaymentReviews />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/payment-reviews (dark)', container);
  });

  it('/admin/users renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/users',
      '/admin/users',
      <RequireAdmin>
        <AdminUsers />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/users (dark)', container);
  });

  it('/admin/slots renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) {
        return { reports: [adminReport()], total: 1, limit: 50, offset: 0 };
      }
      if (url.startsWith('/api/v1/admin/payment-reviews')) {
        return { reviews: [], total: 0, limit: 50, offset: 0 };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/slots',
      '/admin/slots',
      <RequireAdmin>
        <AdminSlots />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/slots (dark)', container);
  });

  it('/admin/audit renders without critical/serious violations (dark)', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/audit-events')) {
        return {
          events: [
            { id: 'e1', actor: { id: 'u1', walletDisplay: 'NQ07…0000' }, event_type: 'slot.published', entity_type: 'slot', entity_id: 'slot-1', metadata: { from: 'draft', to: 'published' }, created_at: new Date().toISOString(), request_id: 'r1' },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        };
      }
      return undefined;
    });
    const container = renderAt(
      '/admin/audit',
      '/admin/audit',
      <RequireAdmin>
        <AdminAudit />
      </RequireAdmin>,
    );
    await awaitLoaded();
    await checkAxe('/admin/audit (dark)', container);
  });

  it('/slot/:id error state has no critical/serious violations (dark)', async () => {
    setGuest();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    const container = renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await awaitLoaded();
    expect(container.textContent).toContain('Couldn’t load this page');
    await checkAxe('/slot/:id error (dark)', container);
  });

  it('dialogs have no critical/serious violations (dark)', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/slots/')) return { slot: slotFixture() };
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await awaitLoaded();
    const reportButton = screen.getByRole('button', { name: /report this opening/i });
    await user.click(reportButton);
    await checkAxe('report dialog (dark)', container);
  });
});

describe('axe on the pill nav shell with dark mode forced', () => {
  beforeEach(() => {
    document.documentElement.classList.add('dark');
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    useNotifications.setState({ unread: null });
  });

  it('shell chrome has no critical/serious violations (dark)', async () => {
    const container = renderShell();
    await awaitUnread();
    await checkAxe('shell chrome (dark)', container);
  });

  for (const [path, name] of [
    ['/sell', 'Sell'],
    ['/claims', 'Claims'],
    ['/notifications', 'Notifications'],
    ['/profile', 'Profile'],
  ]) {
    it(`shell with ${name} active has no critical/serious violations (dark)`, async () => {
      const container = renderShell(path);
      await awaitUnread();
      expect(screen.getByRole('link', { name: new RegExp(name, 'i') }).getAttribute('aria-current')).toBe(
        'page',
      );
      await checkAxe(`shell ${name} active (dark)`, container);
    });
  }
});
