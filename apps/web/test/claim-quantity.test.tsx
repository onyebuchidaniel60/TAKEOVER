// @vitest-environment jsdom
// Phase 5n-D: multi-quantity claims — the selector, the request it produces,
// and the display of a quantity above one.
//
// The money rule under test is that the figure shown to the buyer is EXACT:
// the total is base-unit BigInt math, never a float. A selector that rounds,
// or drifts from what the escrow will demand, is a payment bug, so the exact
// multiplication is asserted on its own rather than only through the markup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithClient } from './test-utils';
import { assertZeroCriticalOrSerious, mockFetch, runAxe } from './a11y-helpers';
import SlotDetailPage from '../src/routes/SlotDetailPage';
import ClaimCard from '../src/components/ClaimCard';
import QuantityStepper from '../src/components/QuantityStepper';
import { claimTotalBaseUnits, formatUsdt } from '../src/lib/slots';
import type { ClaimView } from '../src/lib/slots';
import { useAuth } from '../src/store/auth';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuth.setState({ status: 'unauthenticated', user: null, error: null, initialized: true });
});

function slotFixture(available: number, priceUsdt = '1500000'): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'slot-1',
    title: 'Padel — 4 players',
    description: 'Two courts free tonight.',
    category: 'Sports court',
    location_label: 'Mitte',
    starts_at: new Date(now + 2 * 3600_000).toISOString(),
    ends_at: new Date(now + 4 * 3600_000).toISOString(),
    price_usdt: priceUsdt,
    total_quantity: 5,
    available_quantity: available,
    status: 'published',
    published_at: new Date().toISOString(),
    providerDisplay: 'Riverside Club',
    providerUsername: 'riverside',
  };
}

interface Stub {
  claimBodies: unknown[];
}

function stubSlotApi(slot: Record<string, unknown>, opts: { claimStatus?: number } = {}): Stub {
  const claimBodies: unknown[] = [];
  mockFetch((url, init) => {
    if (url.includes('/ownership')) return { isOwner: false };
    if (url.includes('/me/slots')) return { slots: [], total: 0, limit: 3, offset: 0 };
    if (/\/claims$/.test(url) && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      claimBodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (opts.claimStatus && opts.claimStatus >= 400) {
        return { status: opts.claimStatus, json: { error: { code: 'X', message: 'no' } } };
      }
      return {
        slot: { ...slot, available_quantity: 1 },
        claim: {
          id: 'claim-1',
          slot_id: 'slot-1',
          buyer_id: 'u-1',
          quantity: (JSON.parse(String(init?.body ?? '{}')) as { quantity?: number }).quantity ?? 1,
          status: 'active_hold',
          hold_expires_at: new Date(Date.now() + 3600_000).toISOString(),
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
    }
    return { slot };
  });
  return { claimBodies };
}

function authAsBuyer(): void {
  useAuth.setState({
    status: 'authenticated',
    user: {
      id: 'u-1',
      walletAddress: 'NQ3200000000000000000000000000000000',
      role: 'buyer',
      status: 'active',
    },
    error: null,
    initialized: true,
  });
}

function renderDetail(): void {
  renderWithClient(
    <MemoryRouter initialEntries={['/slot/slot-1']}>
      <Routes>
        <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        <Route path="/claim/:claimId" element={<div>claim-stub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// The 5 s vitest default is too tight for these under parallel load: the slot
// query, the ownership probe and the debounced availability check must all
// settle before the CTA exists, and this machine's jsdom env setup alone runs
// ~40 s when the whole suite is loaded (proven: the same tests pass in 0.6 s
// when run with -t).
const SLOW = { timeout: 30_000 } as const;
// Generous findBy timeout for the same reason — a 1 s default is what turned a
// load spike into a false "the CTA is missing" failure.
const FIND = { timeout: 10_000 } as const;

describe('quantity selector (Phase 5n-D)', () => {
  it('shows NO selector and keeps the original CTA when exactly one is available', SLOW, async () => {
    authAsBuyer();
    stubSlotApi(slotFixture(1));
    renderDetail();
    expect(await screen.findByRole('button', { name: /claim this slot/i }, FIND)).toBeTruthy();
    expect(screen.queryByText(/how many\?/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /one more slot/i })).toBeNull();
  });

  it('shows the selector when more than one is available, defaulting to 1', SLOW, async () => {
    authAsBuyer();
    stubSlotApi(slotFixture(3));
    renderDetail();
    expect(await screen.findByText(/how many\?/i, {}, FIND)).toBeTruthy();
    expect(screen.getByRole('button', { name: /one more slot/i })).toBeTruthy();
    // At one unit the CTA copy is exactly what it has always been.
    expect(screen.getByRole('button', { name: /claim this slot/i })).toBeTruthy();
  });

  it('the total is price x quantity, updating live and in exact base-unit math', SLOW, async () => {
    authAsBuyer();
    // 1.5 USDT per slot.
    stubSlotApi(slotFixture(3, '1500000'));
    renderDetail();
    await screen.findByText(/how many\?/i, {}, FIND);
    const user = userEvent.setup();
    // Scoped to the stepper: the price card legitimately shows the SAME "1.5"
    // unit price, so an unscoped getByText is ambiguous rather than wrong.
    const stepper = () =>
      screen.getByRole('region', { name: /how many/i }) as HTMLElement;
    expect(within(stepper()).getByText('1.5')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /one more slot/i }));
    // 2 -> 3 USDT. Never "2.9999999", never "3.0000000000000004".
    await waitFor(() => expect(within(stepper()).getByText('3')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /one more slot/i }));
    // 3 -> 4.5 USDT
    await waitFor(() => expect(within(stepper()).getByText('4.5')).toBeTruthy());
  });

  it('the CTA states the chosen quantity', SLOW, async () => {
    authAsBuyer();
    stubSlotApi(slotFixture(3));
    renderDetail();
    const user = userEvent.setup();
    await screen.findByText(/how many\?/i, {}, FIND);
    await user.click(screen.getByRole('button', { name: /one more slot/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /claim 2 slots/i })).toBeTruthy(),
    );
  });

  it('bounds are structural: minus is dead at 1, plus is dead at the maximum', SLOW, async () => {
    authAsBuyer();
    stubSlotApi(slotFixture(2));
    renderDetail();
    const user = userEvent.setup();
    await screen.findByText(/how many\?/i, {}, FIND);
    const minus = screen.getByRole('button', { name: /one fewer slot/i });
    const plus = screen.getByRole('button', { name: /one more slot/i });
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    await user.click(plus);
    await waitFor(() => expect((plus as HTMLButtonElement).disabled).toBe(true));
    expect((minus as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the chosen quantity to the server', SLOW, async () => {
    authAsBuyer();
    const stub = stubSlotApi(slotFixture(3));
    renderDetail();
    const user = userEvent.setup();
    await screen.findByText(/how many\?/i, {}, FIND);
    await user.click(screen.getByRole('button', { name: /one more slot/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /claim 2 slots/i })).toBeTruthy(),
    );
    await user.click(screen.getByRole('button', { name: /claim 2 slots/i }));
    await waitFor(() => expect(stub.claimBodies).toHaveLength(1));
    expect(stub.claimBodies[0]).toEqual({ quantity: 2 });
  });

  it('sends an EMPTY body when there is no selector (a one-vacancy slot)', SLOW, async () => {
    // With a selector on screen the number is always explicit. The
    // pre-5n-D `{}` body is what a slot with ONE vacancy must still send —
    // that is the request every older client makes, unchanged.
    authAsBuyer();
    const stub = stubSlotApi(slotFixture(1));
    renderDetail();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: /claim this slot/i }, FIND);
    await user.click(screen.getByRole('button', { name: /claim this slot/i }));
    await waitFor(() => expect(stub.claimBodies).toHaveLength(1));
    expect(stub.claimBodies[0]).toEqual({});
  });

  it('shows no selector to the slot owner', SLOW, async () => {
    useAuth.setState({
      status: 'authenticated',
      user: { id: 'u-1', walletAddress: 'NQ3200000000000000000000000000000000', role: 'provider', status: 'active' },
      error: null,
      initialized: true,
    });
    mockFetch((url) => {
      if (url.includes('/ownership')) return { isOwner: true };
      return { slot: slotFixture(3) };
    });
    renderDetail();
    await screen.findByText(/this is your opening/i, {}, FIND);
    expect(screen.queryByText(/how many\?/i)).toBeNull();
  });

  it('shows no selector to a guest', SLOW, async () => {
    mockFetch(() => ({ slot: slotFixture(3) }));
    renderDetail();
    await screen.findByText(/connect your wallet/i, {}, FIND);
    expect(screen.queryByText(/how many\?/i)).toBeNull();
  });

  it('passes axe with the selector present', SLOW, async () => {
    authAsBuyer();
    stubSlotApi(slotFixture(3));
    const { container } = renderWithClient(
      <MemoryRouter initialEntries={['/slot/slot-1']}>
        <Routes>
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/how many\?/i, {}, FIND);
    assertZeroCriticalOrSerious(await runAxe(container), '/slot (quantity selector)');
  });

  it('the step component alone passes axe', async () => {
    const { container } = render(
      <QuantityStepper value={2} max={4} unitPriceBaseUnits="1500000" onChange={() => {}} />,
    );
    expect(await screen.findByText(/how many\?/i)).toBeTruthy();
    assertZeroCriticalOrSerious(await runAxe(container), 'QuantityStepper');
  });
});

// The exact-multiplication contract, asserted directly. Everything else in
// this file could pass with a sloppy total; this cannot.
describe('claimTotalBaseUnits (exact money math)', () => {
  it('multiplies in base units without float drift', () => {
    expect(claimTotalBaseUnits('1500000', 3)).toBe('4500000');
    expect(claimTotalBaseUnits('100000', 1)).toBe('100000');
    // The classic float trap: 0.1 x 3 must be exactly 0.3.
    expect(formatUsdt(claimTotalBaseUnits('100000', 3))).toBe('0.3 USDT');
    expect(claimTotalBaseUnits('1', 3)).toBe('3');
  });
});

describe('quantity display on claims (Phase 5n-D)', () => {
  function claimFixture(quantity: number): ClaimView {
    return {
      id: 'claim-1',
      slot_id: 'slot-1',
      buyer_id: 'u-1',
      quantity,
      status: 'escrow_funded',
      hold_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  it('states the count when a claim holds more than one', () => {
    render(
      <MemoryRouter>
        <ClaimCard claim={claimFixture(3)} />
      </MemoryRouter>,
    );
    expect(screen.getByText('3 slots')).toBeTruthy();
  });

  it('shows NO count at one unit — no clutter on every row', () => {
    render(
      <MemoryRouter>
        <ClaimCard claim={claimFixture(1)} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/slots/)).toBeNull();
  });

  it('claims list row passes axe', async () => {
    const { container } = render(
      <MemoryRouter>
        <ClaimCard claim={claimFixture(4)} />
      </MemoryRouter>,
    );
    assertZeroCriticalOrSerious(await runAxe(container), 'ClaimCard (quantity)');
  });
});