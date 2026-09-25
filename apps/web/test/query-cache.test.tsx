// @vitest-environment jsdom
// TanStack Query cache behavior (Phase 5c): revisits render cached
// data with no skeleton and no refetch inside the stale window;
// mutations invalidate the keys they affect.
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../src/routes/Home';
import NotificationsSection from '../src/components/NotificationsSection';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import { mockFetch, setBuyer, setGuest, slotFixture, claimFixture } from './a11y-helpers';
import { renderWithClient } from './test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Production-like client: fresh inside 30s staleTime (the app default).
function cachingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
}

function slotsList(total = 2): Record<string, unknown> {
  return {
    slots: [slotFixture(), slotFixture({ id: 'slot-2', title: 'Yoga at sunrise' })],
    total,
    limit: 20,
    offset: 0,
  };
}

describe('stale-while-revalidate on revisit', () => {
  it('remounts the feed from cache: no skeleton, no second fetch', async () => {
    setGuest();
    let calls = 0;
    mockFetch((url: string) => {
      if (url.startsWith('/api/v1/slots')) {
        calls += 1;
        return slotsList();
      }
      return undefined;
    });
    const client = cachingClient();
    const tree = (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>
    );
    const first = renderWithClient(tree, client);
    await screen.findByText('Table for two — tonight');
    expect(calls).toBe(1);
    first.unmount();
    cleanup();
    // Remount with the same client: cached data renders synchronously —
    // no loading state, no refetch.
    renderWithClient(tree, client);
    expect(screen.getByText('Table for two — tonight')).toBeTruthy();
    expect(screen.queryByLabelText(/loading/i)).toBeNull();
    expect(calls).toBe(1);
  });
});

describe('mutation invalidation', () => {
  it('mark-all-read refetches the shared notifications cache', async () => {
    setBuyer();
    let calls = 0;
    mockFetch((url: string, init?: RequestInit) => {
      if (url === '/api/v1/me/notifications') {
        if ((init?.method ?? 'GET') === 'GET') {
          calls += 1;
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
        return { marked: 1 };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithClient(
      <MemoryRouter>
        <NotificationsSection />
      </MemoryRouter>,
      cachingClient(),
    );
    await screen.findByText('Marked delivered');
    expect(calls).toBe(1);
    await user.click(screen.getByRole('button', { name: /mark all read/i }));
    await screen.findByText('Marking…').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('claim creation invalidates the slot cache (remount refetches)', async () => {
    setBuyer();
    const counts = { slot: 0, claims: 0 };
    const liveSlot = {
      ...slotFixture(),
      starts_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      ends_at: new Date(Date.now() + 4 * 3600_000).toISOString(),
      status: 'published',
      available_quantity: 3,
    };
    mockFetch((url: string, init?: RequestInit) => {
      if (url.endsWith('/ownership')) return { isOwner: false };
      if (url === '/api/v1/slots/slot-1' && (init?.method ?? 'GET') === 'GET') {
        counts.slot += 1;
        return { slot: liveSlot };
      }
      if (url === '/api/v1/slots/slot-1/claims' && init?.method === 'POST') {
        counts.claims += 1;
        return { claim: claimFixture(), slot: liveSlot };
      }
      if (url === '/api/v1/claims/claim-1') return { claim: claimFixture(), slot: liveSlot };
      if (url.includes('/claims/claim-1/escrow')) {
        return { status: 404, json: { error: { code: 'ESCROW_NOT_FOUND', message: 'No escrow.' } } };
      }
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
          slot: liveSlot,
        };
      }
      return undefined;
    });
    const client = cachingClient();
    const user = userEvent.setup();
    const { unmount } = renderWithClient(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
          <Route path="/claim/:claimId" element={<div>claim page</div>} />
        </Routes>
      </MemoryRouter>,
      client,
    );
    await screen.findByRole('button', { name: /claim this slot/i });
    expect(counts.slot).toBe(1);
    await user.click(screen.getByRole('button', { name: /claim this slot/i }));
    await screen.findByText('claim page');
    expect(counts.claims).toBe(1);
    unmount();
    cleanup();
    // The claim invalidated ['slot', slot-1]: remounting refetches.
    renderWithClient(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
      client,
    );
    await screen.findByText('Table for two — tonight');
    expect(counts.slot).toBe(2);
  });
});
