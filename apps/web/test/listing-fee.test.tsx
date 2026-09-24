// @vitest-environment jsdom
// 1 Component tests — SellDetail publish flow with a mocked wallet
// and fetch layer (a11y-helpers harness). Proves: fee disclosure + approve
// button when required; plain publish when not; D6 same-hash retry banner
// after a verify failure; broadcast failure distinct from verify failure;
// misconfigured fee disables publish; Luna conversion of the real
// sendListingFee (via importActual — the module mock below only swaps the
// two functions SellDetail calls).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NimiqProvider } from '@nimiq/mini-app-sdk';
import SellDetail from '../src/routes/SellDetail';
import { err, mockFetch, setBuyer, slotFixture } from './a11y-helpers';

vi.mock('../src/lib/nimiq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/nimiq')>();
  return { ...actual, connectWallet: vi.fn(), sendListingFee: vi.fn() };
});

import { connectWallet, sendListingFee } from '../src/lib/nimiq';

const SLOT_ID = 'slot-1';
const FEE_WALLET = 'NQ0400000000000000000000000000000000';
const HASH = 'ac2f80450d454af19efec4e5d405d964d0d0690fded17e588f033d74998317d0';

function draftSlot(): Record<string, unknown> {
  return slotFixture({
    id: SLOT_ID,
    status: 'draft',
    payout_wallet: 'NQ0700000000000000000000000000000000',
    provider_contact_note: null,
    published_at: null,
  });
}

function publishedSlot(): Record<string, unknown> {
  return { ...draftSlot(), status: 'published', published_at: new Date().toISOString() };
}

describe('NIM listing fee publish flow', () => {
  const publishBodies: Array<unknown> = [];
  let publishHandler: () => unknown = () => ({ slot: publishedSlot() });

  beforeEach(() => {
    publishBodies.length = 0;
    publishHandler = () => ({ slot: publishedSlot() });
    vi.mocked(connectWallet).mockReset();
    vi.mocked(sendListingFee).mockReset();
    vi.mocked(connectWallet).mockResolvedValue({ provider: {} as NimiqProvider, accounts: ['NQ07'] });
    vi.mocked(sendListingFee).mockResolvedValue(HASH);
    window.sessionStorage.clear();
    setBuyer();
  });

  function renderWithConfig(listingFee: Record<string, unknown>): void {
    mockFetch((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/config')) {
        return { listingFee };
      }
      if (url.includes('/publish')) {
        const body = init?.body !== undefined ? JSON.parse(String(init.body)) : {};
        publishBodies.push(body);
        return publishHandler();
      }
      if (url.includes(`/api/v1/slots/${SLOT_ID}`)) {
        return { slot: draftSlot() };
      }
      return err(404, 'NOT_FOUND', 'Slot not found.');
    });
    render(
      <MemoryRouter initialEntries={[`/sell/${SLOT_ID}`]}>
        <Routes>
          <Route path="/sell/:slotId" element={<SellDetail />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const requiredFee = { required: true, amountNim: '15', walletAddress: FEE_WALLET };
  const noFee = { required: false, amountNim: null, walletAddress: null };

  it('pays the fee then publishes when required', async () => {
    renderWithConfig(requiredFee);
    expect(await screen.findByText('Pay 15 NIM through Nimiq Pay to publish.')).toBeDefined();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve payment & publish' }));
    await waitFor(() => expect(vi.mocked(sendListingFee)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendListingFee)).toHaveBeenCalledWith(
      {},
      { to: FEE_WALLET, nimAmount: '15', slotId: SLOT_ID },
    );
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    expect(publishBodies[0]).toEqual({ transactionHash: HASH });
    // Published slot renders the published state.
    expect(await screen.findByText(/be edited/)).toBeDefined();
  });

  it('publishes plainly without touching the wallet when no fee is required', async () => {
    renderWithConfig(noFee);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    expect(publishBodies[0]).toEqual({});
    expect(vi.mocked(sendListingFee)).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pay 15 NIM/)).toBeNull();
  });

  it('shows the retry banner after a verify failure and retries with the same hash (D6)', async () => {
    publishHandler = () =>
      publishBodies.length === 1
        ? err(409, 'PAYMENT_NOT_CONFIRMED', 'Fee payment needs 3 confirmations (1 so far).')
        : { slot: publishedSlot() };
    renderWithConfig(requiredFee);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve payment & publish' }));
    expect(
      await screen.findByText('Payment sent — waiting for confirmations. Retry with the same transaction.'),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry publish' }));
    await waitFor(() => expect(publishBodies).toHaveLength(2));
    // Same hash, manual retry only — no second broadcast.
    expect(publishBodies[0]).toEqual({ transactionHash: HASH });
    expect(publishBodies[1]).toEqual({ transactionHash: HASH });
    expect(vi.mocked(sendListingFee)).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/be edited/)).toBeDefined();
  });

  it('removes the approve button once a fee hash exists (no double charge)', async () => {
    publishHandler = () =>
      err(409, 'PAYMENT_NOT_CONFIRMED', 'Fee payment needs 3 confirmations (0 so far).');
    renderWithConfig(requiredFee);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve payment & publish' }));
    await screen.findByRole('button', { name: 'Retry publish' });
    // The wallet path is gone while the hash exists: no approve button,
    // so no second payment is possible from this screen.
    expect(screen.queryByRole('button', { name: 'Approve payment & publish' })).toBeNull();
    expect(vi.mocked(sendListingFee)).toHaveBeenCalledTimes(1);
  });

  it('offers a de-emphasized new-payment hatch on a fatal hash, restoring approve', async () => {
    publishHandler = () =>
      err(409, 'PAYMENT_DATA_MISMATCH', 'Fee payment does not match this opening. Fee transfers are final.');
    renderWithConfig(requiredFee);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve payment & publish' }));
    await screen.findByRole('button', { name: 'Retry publish' });
    expect(screen.queryByRole('button', { name: 'Approve payment & publish' })).toBeNull();
    const hatch = await screen.findByRole('button', { name: 'Use a new payment instead' });
    await user.click(hatch);
    expect(await screen.findByRole('button', { name: 'Approve payment & publish' })).toBeTruthy();
    // The hatch discarded the hash without paying: still one broadcast.
    expect(vi.mocked(sendListingFee)).toHaveBeenCalledTimes(1);
  });

  it('restores a pre-reload hash from session storage as retry-only', async () => {
    window.sessionStorage.setItem(`takeover.feeHash.${SLOT_ID}`, HASH);
    renderWithConfig(requiredFee);
    // No click, no wallet: the stored hash returns as a retry banner.
    expect(
      await screen.findByText('A fee payment is already on record for this opening. Retry with the same transaction.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Approve payment & publish' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry publish' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    expect(publishBodies[0]).toEqual({ transactionHash: HASH });
    expect(vi.mocked(sendListingFee)).not.toHaveBeenCalled();
    expect(vi.mocked(connectWallet)).not.toHaveBeenCalled();
  });

  it('surfaces a broadcast failure without the retry banner (nothing on-chain)', async () => {
    vi.mocked(sendListingFee).mockRejectedValue(new Error('User rejected the transaction.'));
    renderWithConfig(requiredFee);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve payment & publish' }));
    // The wallet message surfaces (in both the form-level and page-level
    // error slots — the pre-existing SlotForm serverError pattern).
    const matches = await screen.findAllByText('User rejected the transaction.');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Retry with the same transaction/)).toBeNull();
    expect(publishBodies).toHaveLength(0);
  });

  it('disables publish when the fee is misconfigured', async () => {
    renderWithConfig({
      required: true,
      amountNim: '15',
      walletAddress: null,
      misconfigured: true,
    });
    expect(
      await screen.findByText('Listing fee is misconfigured. Publishing is unavailable — contact support.'),
    ).toBeDefined();
    // The publish button stays dumb ("Publish") and disabled; the banner
    // carries the reason.
    const button = (await screen.findByRole('button', { name: 'Publish' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe('sendListingFee conversion (real function)', () => {
  it('sends exact Luna with the fee binding', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/nimiq')>('../src/lib/nimiq');
    const calls: Array<{ recipient: string; value: number; data: string }> = [];
    const provider = {
      sendBasicTransactionWithData: (args: { recipient: string; value: number; data: string }) => {
        calls.push(args);
        return Promise.resolve(HASH);
      },
    } as unknown as NimiqProvider;
    const hash = await actual.sendListingFee(provider, {
      to: FEE_WALLET,
      nimAmount: '15',
      slotId: SLOT_ID,
    });
    expect(hash).toBe(HASH);
    expect(calls).toEqual([
      { recipient: FEE_WALLET, value: 1500000, data: `TAKEOVER:fee:v1:${SLOT_ID}` },
    ]);
  });

  it('rejects invalid amounts without touching the wallet', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/nimiq')>('../src/lib/nimiq');
    const provider = {
      sendBasicTransactionWithData: () => Promise.resolve(HASH),
    } as unknown as NimiqProvider;
    await expect(
      actual.sendListingFee(provider, { to: FEE_WALLET, nimAmount: 'free', slotId: SLOT_ID }),
    ).rejects.toThrow();
    await expect(
      actual.sendListingFee(provider, { to: FEE_WALLET, nimAmount: '0', slotId: SLOT_ID }),
    ).rejects.toThrow();
  });
});
