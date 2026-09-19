// @vitest-environment jsdom
// state rendering: one suite per route proving loading, empty,
// error, not-found, and unavailable states render the right component for
// mocked conditions. Titles and the admin robots tag are asserted alongside.
// Case-B flake note: document.title and head meta are written by usePageMeta
// inside a React useEffect, so every assertion on them that follows an
// awaited query uses await waitFor (condition-based, no elapsed-time
// assumption) instead of a synchronous expect — the content commit and the
// effect commit are not guaranteed to flush together (diagnosed: sync assert
// read the pre-effect 'Slot — TAKEOVER' loading title at 73ms).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import RequireAuth from '../src/components/RequireAuth';
import AdminAudit from '../src/routes/admin/AdminAudit';
import AdminDashboard from '../src/routes/admin/AdminDashboard';
import AdminPaymentReviews from '../src/routes/admin/AdminPaymentReviews';
import AdminReports from '../src/routes/admin/AdminReports';
import AdminSlots from '../src/routes/admin/AdminSlots';
import AdminUsers from '../src/routes/admin/AdminUsers';
import ClaimDetailPage from '../src/routes/ClaimDetailPage';
import ClaimsPage from '../src/routes/ClaimsPage';
import Home from '../src/routes/Home';
import NotFound from '../src/routes/NotFound';
import Profile from '../src/routes/Profile';
import Sell from '../src/routes/Sell';
import SellDetail from '../src/routes/SellDetail';
import SellNew from '../src/routes/SellNew';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import {
  claimFixture,
  err,
  meFixture,
  mockFetch,
  pendingForever,
  setAdmin,
  setBuyer,
  setGuest,
  slotFixture,
} from './a11y-helpers';

function renderAt(path: string, route: string, element: React.ReactNode): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<>{element}</>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('/ states', () => {
  it('loading shows a skeleton, not a spinner', () => {
    setGuest();
    mockFetch(() => pendingForever());
    renderAt('/', '/', <Home />);
    expect(screen.getByLabelText(/loading/i)).toBeDefined();
    expect(document.title).toContain('TAKEOVER');
  });

  it('empty shows contextual copy, error shows message + retry', async () => {
    setGuest();
    mockFetch(() => ({ slots: [], total: 0, limit: 20, offset: 0 }));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/nothing available right now/i);
    unmount();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    renderAt('/', '/', <Home />);
    await screen.findByText(/couldn’t load this page/i);
    await screen.findByRole('button', { name: /try again/i });
  });
});

describe('/slot/:id states', () => {
  it('not-found uses the 404-styled page', async () => {
    setGuest();
    mockFetch(() => err(404, 'NOT_FOUND', 'Slot not found.'));
    renderAt('/slot/slot-9', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByText(/no longer available/i);
    // Title is usePageMeta-driven (effect); wait for the effect, don't assume
    // it flushed with the content commit.
    await waitFor(() => {
      expect(document.title).toBe('Slot — TAKEOVER');
    });
  });

  it('sold-out is an explicit unavailable state, not an error', async () => {
    setGuest();
    mockFetch(() => ({ slot: slotFixture({ available_quantity: 0, status: 'sold_out' }) }));
    renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByText(/sold out/i);
    await screen.findByText(/just missed it/i);
    await waitFor(() => {
      expect(document.title).toContain('Table for two');
    });
  });

  it('loaded slot sets title, price, and share preview meta', async () => {
    setGuest();
    mockFetch(() => ({ slot: slotFixture() }));
    renderAt('/slot/slot-1', '/slot/:slotId', <SlotDetailPage />);
    await screen.findByText('Table for two — tonight');
    await waitFor(() => {
      expect(document.title).toBe('Table for two — tonight — TAKEOVER');
      expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain(
        'Table for two',
      );
    });
  });
});

describe('/claim/:id states', () => {
  it('not-found explains the hold may belong elsewhere', async () => {
    setBuyer();
    mockFetch(() => err(404, 'CLAIM_NOT_FOUND', 'Claim not found.'));
    renderAt(
      '/claim/nope',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    await screen.findByText(/hold not found/i);
    await waitFor(() => {
      expect(document.title).toBe('Claim — TAKEOVER');
    });
  });

  it('expired is an explicit unavailable state with a re-claim path', async () => {
    setBuyer();
    mockFetch(() => ({ claim: claimFixture('expired'), slot: slotFixture() }));
    renderAt(
      '/claim/claim-1',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    // Badge and unavailable box share the locked "Hold expired" copy.
    expect((await screen.findAllByText(/hold expired/i)).length).toBe(2);
    await screen.findByRole('link', { name: /claim again/i });
  });

  it('paid shows the paid state only from backend data', async () => {
    setBuyer();
    mockFetch(() => ({ claim: claimFixture('paid'), slot: slotFixture() }));
    renderAt(
      '/claim/claim-1',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    await screen.findByText(/^paid\.$/i);
  });
});

describe('/claims states', () => {
  it('empty and error render contextually', async () => {
    setBuyer();
    mockFetch(() => ({ claims: [], total: 0, limit: 50, offset: 0 }));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/claims']}>
        <Routes>
          <Route
            path="/claims"
            element={
              <RequireAuth>
                <ClaimsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/haven't claimed anything yet/i);
    await screen.findByRole('link', { name: /browse openings/i });
    await waitFor(() => {
      expect(document.title).toBe('My holds — TAKEOVER');
    });
    unmount();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    renderAt(
      '/claims',
      '/claims',
      <RequireAuth>
        <ClaimsPage />
      </RequireAuth>,
    );
    await screen.findByRole('button', { name: /try again/i });
  });
});

describe('/sell states', () => {
  it('empty and error render contextually', async () => {
    setBuyer();
    mockFetch(() => ({ slots: [], total: 0, limit: 50, offset: 0 }));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <Routes>
          <Route
            path="/sell"
            element={
              <RequireAuth>
                <Sell />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/no openings yet/i);
    await waitFor(() => {
      expect(document.title).toBe('My openings — TAKEOVER');
    });
    unmount();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    renderAt(
      '/sell',
      '/sell',
      <RequireAuth>
        <Sell />
      </RequireAuth>,
    );
    await screen.findByRole('button', { name: /try again/i });
  });
});

describe('/sell/new states', () => {
  it('renders the form and validates inline before submitting', async () => {
    setBuyer();
    mockFetch(() => undefined);
    renderAt(
      '/sell/new',
      '/sell/new',
      <RequireAuth>
        <SellNew />
      </RequireAuth>,
    );
    const user = userEvent.setup();
    await screen.findByLabelText(/title/i);
    await waitFor(() => {
      expect(document.title).toBe('New opening — TAKEOVER');
    });
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await screen.findByText(/give your opening a title/i);
  });
});

describe('/sell/:id states', () => {
  it('not-found and error render distinctly', async () => {
    setBuyer();
    mockFetch(() => err(404, 'NOT_FOUND', 'Slot not found.'));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/sell/nope']}>
        <Routes>
          <Route
            path="/sell/:slotId"
            element={
              <RequireAuth>
                <SellDetail />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/opening not found/i);
    await waitFor(() => {
      expect(document.title).toBe('Manage opening — TAKEOVER');
    });
    unmount();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    renderAt(
      '/sell/slot-1',
      '/sell/:slotId',
      <RequireAuth>
        <SellDetail />
      </RequireAuth>,
    );
    await screen.findByRole('button', { name: /try again/i });
  });

  it('draft shows the editable form plus publish action', async () => {
    setBuyer();
    mockFetch(() => ({
      slot: { ...slotFixture(), payout_wallet: 'NQ0700000000000000000000000000000000', status: 'draft' },
    }));
    renderAt(
      '/sell/slot-1',
      '/sell/:slotId',
      <RequireAuth>
        <SellDetail />
      </RequireAuth>,
    );
    await screen.findByLabelText(/title/i);
    await screen.findByRole('button', { name: /^publish$/i });
  });
});

describe('/profile states', () => {
  it('error shows retry; loaded profile shows wallet and role', async () => {
    setBuyer();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /try again/i });
    await waitFor(() => {
      expect(document.title).toBe('Profile — TAKEOVER');
    });
    unmount();
    mockFetch((url) => {
      if (url === '/api/v1/me') return { user: meFixture() };
      return { slots: [], total: 0, limit: 1, offset: 0 };
    });
    renderAt(
      '/profile',
      '/profile',
      <RequireAuth>
        <Profile />
      </RequireAuth>,
    );
    await screen.findByText(/buyer/i);
  });
});

describe('admin route states', () => {
  it('/admin dashboard error shows retry', async () => {
    setAdmin();
    mockFetch(() => err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    renderAt('/admin', '/admin', <AdminDashboard />);
    await screen.findByRole('button', { name: /try again/i });
    await waitFor(() => {
      expect(document.title).toBe('Moderation — TAKEOVER');
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    });
  });

  it('/admin/reports empty is contextual', async () => {
    setAdmin();
    mockFetch(() => ({ reports: [], total: 0, limit: 20, offset: 0 }));
    renderAt('/admin/reports', '/admin/reports', <AdminReports />);
    await screen.findByText(/no reports/i);
  });

  it('/admin/payment-reviews empty is contextual', async () => {
    setAdmin();
    mockFetch(() => ({ reviews: [], total: 0, limit: 20, offset: 0 }));
    renderAt('/admin/payment-reviews', '/admin/payment-reviews', <AdminPaymentReviews />);
    await screen.findByText(/nothing under review/i);
  });

  it('/admin/users empty still offers direct-id disable', async () => {
    setAdmin();
    mockFetch(() => ({ reports: [], total: 0, limit: 50, offset: 0 }));
    renderAt('/admin/users', '/admin/users', <AdminUsers />);
    await screen.findByText(/no users found/i);
    await screen.findByLabelText(/disable an account by id/i);
  });

  it('/admin/slots empty still offers direct-id disable', async () => {
    setAdmin();
    mockFetch((url) => {
      if (url.startsWith('/api/v1/admin/reports')) return { reports: [], total: 0, limit: 50, offset: 0 };
      if (url.startsWith('/api/v1/admin/payment-reviews')) {
        return { reviews: [], total: 0, limit: 50, offset: 0 };
      }
      return undefined;
    });
    renderAt('/admin/slots', '/admin/slots', <AdminSlots />);
    await screen.findByText(/no listings found/i);
    await screen.findByLabelText(/disable a listing by id/i);
  });

  it('/admin/audit empty is contextual', async () => {
    setAdmin();
    mockFetch(() => ({ events: [], total: 0, limit: 20, offset: 0 }));
    renderAt('/admin/audit', '/admin/audit', <AdminAudit />);
    await screen.findByText(/no events/i);
  });

  it('leaving admin clears the robots tag', async () => {
    setAdmin();
    mockFetch(() => ({ reports: [], total: 0, limit: 20, offset: 0 }));
    const { unmount } = render(
      <MemoryRouter initialEntries={['/admin/reports']}>
        <Routes>
          <Route path="/admin/reports" element={<AdminReports />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/no reports/i);
    await waitFor(() => {
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    });
    unmount();
    setGuest();
    mockFetch(() => ({ slots: [], total: 0, limit: 20, offset: 0 }));
    renderAt('/', '/', <Home />);
    await screen.findByText(/nothing available right now/i);
    await waitFor(() => {
      expect(document.querySelector('meta[name="robots"]')).toBeNull();
    });
  });
});

describe('claim payment states', () => {
  it('active hold shows the escrow pay action; review shows the review notice', async () => {
    setBuyer();
    mockFetch((url) => {
      if (url.includes('/escrow-intent')) {
        return {
          escrow: { id: 'escrow-1', claim_id: 'claim-1', status: 'created' },
          claim: claimFixture(),
          depositInstruction: {
            contractAddress: '0x7f8f66e1e07372dc371edf8f21d2d84208a4fc06',
            tokenAddress: '0xc885e1eed2a2f2215b756fa04b89aad1a27559de',
            usdtAmount: '1500000',
            onChainEscrowId: `0x${'ab'.repeat(32)}`,
            approveTo: '0x7f8f66e1e07372dc371edf8f21d2d84208a4fc06',
            approveAmount: '1500000',
            buyerWallet: 'buyer-evm-wallet',
          },
          slot: slotFixture(),
        };
      }
      if (url.includes('/claims/claim-1/escrow')) {
        return err(404, 'ESCROW_NOT_FOUND', 'No escrow for this claim.');
      }
      return { claim: claimFixture('active_hold'), slot: slotFixture() };
    });
    const { unmount } = render(
      <MemoryRouter initialEntries={['/claim/claim-1']}>
        <Routes>
          <Route
            path="/claim/:claimId"
            element={
              <RequireAuth>
                <ClaimDetailPage />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Pay with USDT on Polygon');
    await screen.findByRole('button', { name: /approve & deposit/i });
    unmount();
    mockFetch(() => ({ claim: claimFixture('payment_review'), slot: slotFixture() }));
    renderAt(
      '/claim/claim-1',
      '/claim/:claimId',
      <RequireAuth>
        <ClaimDetailPage />
      </RequireAuth>,
    );
    // Badge and review notice share the locked "Payment under review" copy.
    expect((await screen.findAllByText(/payment under review/i)).length).toBe(2);
  });
});

describe('catch-all route', () => {
  it('unknown paths render the 404 page with a way home', async () => {
    setGuest();
    mockFetch(() => undefined);
    renderAt('/definitely-not-a-page', '*', <NotFound />);
    await screen.findByText(/doesn’t exist/i);
    await screen.findByRole('link', { name: /see available openings/i });
  });
});
