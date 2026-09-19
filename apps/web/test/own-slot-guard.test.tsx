// @vitest-environment jsdom
// Owner claim-button gate: the viewer who provides the slot sees no claim
// action — just "This is your opening." Non-owners see the ClaimButton as
// before; an ownership-probe failure fails open (backend stays authoritative).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import { useAuth } from '../src/store/auth';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
});

function slotFixture(): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'slot-1',
    title: 'Table for two — tonight',
    description: 'A cozy corner table.',
    category: 'dining',
    location_label: 'Mitte',
    starts_at: new Date(now + 2 * 3600_000).toISOString(),
    ends_at: new Date(now + 4 * 3600_000).toISOString(),
    price_usdt: '150000',
    total_quantity: 4,
    available_quantity: 3,
    status: 'published',
    published_at: new Date().toISOString(),
    providerDisplay: 'Manual Bistro',
  };
}

function stubFetch(handler: (url: string) => { status: number; body: unknown }): { seen: string[] } {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    (async (url: unknown) => {
      const u = String(url);
      seen.push(u);
      const { status, body } = handler(u);
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

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/slot/slot-1']}>
      <Routes>
        <Route path="/slot/:slotId" element={<SlotDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('owner claim-button gate', () => {
  it('hides the claim action and notes ownership for the provider', async () => {
    authAsBuyer();
    const { seen } = stubFetch((url) => {
      if (url.endsWith('/ownership')) {
        return { status: 200, body: { data: { isOwner: true }, requestId: 't' } };
      }
      if (url.includes('/api/v1/slots/')) {
        return { status: 200, body: { data: { slot: slotFixture() }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    renderDetail();
    expect(await screen.findByText('Table for two — tonight')).toBeTruthy();
    expect(await screen.findByText('This is your opening.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /claim this opening/i })).toBeNull();
    expect(seen.some((u) => u.endsWith('/slots/slot-1/ownership'))).toBe(true);
  });

  it('shows the claim action for a non-owner', async () => {
    authAsBuyer();
    stubFetch((url) => {
      if (url.endsWith('/ownership')) {
        return { status: 200, body: { data: { isOwner: false }, requestId: 't' } };
      }
      if (url.includes('/api/v1/slots/')) {
        return { status: 200, body: { data: { slot: slotFixture() }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    renderDetail();
    expect(await screen.findByRole('button', { name: /claim this opening/i })).toBeTruthy();
    expect(screen.queryByText('This is your opening.')).toBeNull();
  });

  it('fails open when the ownership probe errors (backend stays authoritative)', async () => {
    authAsBuyer();
    stubFetch((url) => {
      if (url.endsWith('/ownership')) {
        return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Oops.' }, requestId: 't' } };
      }
      if (url.includes('/api/v1/slots/')) {
        return { status: 200, body: { data: { slot: slotFixture() }, requestId: 't' } };
      }
      return { status: 200, body: { data: {}, requestId: 't' } };
    });
    renderDetail();
    expect(await screen.findByRole('button', { name: /claim this opening/i })).toBeTruthy();
  });

  it('offers no claim action while ownership is still resolving', async () => {
    authAsBuyer();
    vi.stubGlobal(
      'fetch',
      ((url: unknown) => {
        const u = String(url);
        // The ownership probe never settles: slot loaded, gate pending.
        if (u.endsWith('/ownership')) return new Promise(() => {});
        const body = u.includes('/api/v1/slots/')
          ? { data: { slot: slotFixture() }, requestId: 't' }
          : { data: {}, requestId: 't' };
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve(body),
        } as unknown as Response);
      }) as typeof fetch,
    );
    renderDetail();
    expect(await screen.findByText('Table for two — tonight')).toBeTruthy();
    // Slot loaded, ownership pending: neither the button nor the note.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /claim this opening/i })).toBeNull();
    });
    expect(screen.queryByText('This is your opening.')).toBeNull();
  });
});
