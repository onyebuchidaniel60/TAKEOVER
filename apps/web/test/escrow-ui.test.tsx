// @vitest-environment jsdom
// Escrow buyer-loop component tests. window.ethereum is
// mocked at the lib/evm module boundary; the backend is a stubbed fetch
// serving ARCHITECTURE.md §13 envelopes. No network, no wallet.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/evm', () => ({
  getEthereumProvider: vi.fn(),
  ensureChain: vi.fn(),
  getAccounts: vi.fn(),
  approve: vi.fn(),
  deposit: vi.fn(),
  sendTransaction: vi.fn(),
  waitForReceipt: vi.fn(),
  DISPUTE_GAS_LIMIT: '0x186a0',
}));

import * as evm from '../src/lib/evm';
import ClaimCard from '../src/components/ClaimCard';
import ClaimStatusBadge from '../src/components/ClaimStatusBadge';
import ConfirmReceiptBox from '../src/components/ConfirmReceiptBox';
import SlotForm, { type SlotFormValues } from '../src/components/SlotForm';
import { validateContactNote } from '../src/lib/slots';
import EscrowPanel from '../src/components/EscrowPanel';
import MarkDeliveredForm from '../src/components/MarkDeliveredForm';
import VerifyDepositBox from '../src/components/VerifyDepositBox';
import SellDetail from '../src/routes/SellDetail';

const CLAIM_ID = '123e4567-e89b-12d3-a456-426614174000';
const CONTRACT = '0x7f8f66e1e07372dc371edf8f21d2d84208a4fc06';
const TOKEN = '0xc885e1eed2a2f2215b756fa04b89aad1a27559de';
const EID = `0x${'ab'.repeat(32)}`;
const APPROVE_TX = `0x${'11'.repeat(32)}`;
const DEPOSIT_TX = `0x${'22'.repeat(32)}`;

function claim(status: string): Record<string, unknown> {
  return {
    id: CLAIM_ID,
    slot_id: 'slot-1',
    buyer_id: 'buyer-1',
    quantity: 1,
    status,
    hold_expires_at: new Date(Date.now() + 600_000).toISOString(),
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function escrowRow(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'escrow-1',
    claim_id: CLAIM_ID,
    buyer_id: 'buyer-1',
    payment_token: 'USDT_POLYGON',
    amount_base_units: '1500000',
    status,
    contract_address: CONTRACT,
    on_chain_escrow_id: EID,
    deposit_tx_hash: status === 'created' ? null : DEPOSIT_TX,
    funded_at: null,
    delivery_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    provider_payout_address: null,
    delivered_at: null,
    dispute_window_ends: new Date(Date.now() + 86_400_000).toISOString(),
    disputed_at: null,
    release_tx_hash: null,
    refund_tx_hash: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function instruction(): Record<string, unknown> {
  return {
    contractAddress: CONTRACT,
    tokenAddress: TOKEN,
    usdtAmount: '1500000',
    onChainEscrowId: EID,
    approveTo: CONTRACT,
    approveAmount: '1500000',
    buyerWallet: 'buyer-evm-wallet',
  };
}

// Programmable backend surface (reset per test).
const backend: {
  escrow: Record<string, unknown> | null;
  escrowError: string | null;
  verify: Record<string, unknown>;
  confirm: Record<string, unknown>;
  dispute: Record<string, unknown>;
  submissions: unknown[];
} = {
  escrow: null,
  escrowError: null,
  verify: { status: 'pending' },
  confirm: { status: 'pending' },
  dispute: { status: 'pending' },
  submissions: [],
};

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => 'test-request-id' },
    json: async () => payload,
  } as unknown as Response;
}

function errorEnvelope(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: code }, requestId: 'test-request-id' }, false, status);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  backend.escrow = null;
  backend.escrowError = null;
  backend.verify = { status: 'pending' };
  backend.confirm = { status: 'pending' };
  backend.dispute = { status: 'pending' };
  backend.submissions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      if (href.endsWith('/escrow-intent')) {
        return jsonResponse({
          data: { escrow: escrowRow('created'), claim: claim('active_hold'), depositInstruction: instruction() },
        });
      }
      if (href.endsWith('/escrow-submission')) {
        backend.submissions.push(body);
        return jsonResponse({ data: { escrow: escrowRow('created', { deposit_tx_hash: DEPOSIT_TX }), claim: claim('deposit_submitted') } });
      }
      if (href.endsWith('/verify-deposit')) {
        return jsonResponse({ data: { ...backend.verify, escrow: escrowRow('created'), claim: claim('deposit_submitted') } });
      }
      if (href.endsWith('/confirm-receipt')) {
        return jsonResponse({ data: { ...backend.confirm, escrow: escrowRow('delivered'), claim: claim('delivered') } });
      }
      if (href.endsWith('/dispute')) {
        return jsonResponse({ data: { ...backend.dispute, escrow: escrowRow('delivered'), claim: claim('delivered') } });
      }
      if (href.endsWith(`/claims/${CLAIM_ID}/escrow`)) {
        if (backend.escrowError) return errorEnvelope(backend.escrowError, 404);
        return jsonResponse({ data: { escrow: backend.escrow, claim: claim('active_hold') } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as unknown as typeof fetch,
  );
  vi.mocked(evm.getEthereumProvider).mockReturnValue({} as never);
  vi.mocked(evm.ensureChain).mockResolvedValue(undefined);
  vi.mocked(evm.getAccounts).mockResolvedValue(['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  vi.mocked(evm.approve).mockResolvedValue(APPROVE_TX);
  vi.mocked(evm.deposit).mockResolvedValue(DEPOSIT_TX);
  vi.mocked(evm.sendTransaction).mockResolvedValue(DEPOSIT_TX);
  vi.mocked(evm.waitForReceipt).mockResolvedValue({ status: '0x1', blockNumber: '0x10' });
});

afterEach(() => {
  cleanup();
});

describe('EscrowPanel status dispatch', () => {
  const cases: Array<{ escrowError?: string; escrow?: Record<string, unknown>; copy: string }> = [
    { escrowError: 'ESCROW_NOT_FOUND', copy: 'Pay with USDT on Polygon' },
    { escrow: escrowRow('created'), copy: 'Pay with USDT on Polygon' },
    { escrow: escrowRow('created', { deposit_tx_hash: DEPOSIT_TX }), copy: 'Check again' },
    { escrow: escrowRow('funded'), copy: 'Funds in escrow. Waiting for provider.' },
    { escrow: escrowRow('delivered'), copy: 'Service delivered?' },
    { escrow: escrowRow('disputed'), copy: 'Dispute open. Admin will resolve.' },
    { escrow: escrowRow('releasing'), copy: 'Releasing to provider…' },
    { escrow: escrowRow('released'), copy: 'Released. Complete.' },
    { escrow: escrowRow('refunding'), copy: 'Refunding to you…' },
    { escrow: escrowRow('refunded'), copy: 'Refunded. Complete.' },
  ];

  for (const { escrowError, escrow, copy } of cases) {
    it(`escrow ${escrow?.status ?? escrowError} → "${copy}"`, async () => {
      backend.escrow = escrow ?? null;
      backend.escrowError = escrowError ?? null;
      const onUpdate = vi.fn();
      const { unmount } = render(
        <EscrowPanel claim={claim('active_hold') as never} onUpdate={onUpdate} />,
      );
      expect(await screen.findByText(copy)).toBeTruthy();
      unmount();
    });
  }
});

describe('approve & deposit flow', () => {
  it('approves the exact instruction amounts, deposits, and submits the deposit hash', async () => {
    const user = userEvent.setup();
    backend.escrow = null;
    backend.escrowError = 'ESCROW_NOT_FOUND';
    const onSubmitted = vi.fn();
    render(<EscrowPanel claim={claim('active_hold') as never} onUpdate={onSubmitted} />);
    await screen.findByText('Approve & Deposit');
    await user.click(screen.getByText('Approve & Deposit'));
    await waitFor(() => expect(evm.approve).toHaveBeenCalledTimes(1));
    expect(evm.approve).toHaveBeenCalledWith(expect.anything(), {
      token: TOKEN,
      spender: CONTRACT,
      amount: '1500000',
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await waitFor(() => expect(evm.deposit).toHaveBeenCalledTimes(1));
    expect(evm.deposit).toHaveBeenCalledWith(expect.anything(), {
      contract: CONTRACT,
      escrowId: EID,
      amount: '1500000',
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await waitFor(() => expect(backend.submissions).toHaveLength(1));
    expect(backend.submissions[0]).toEqual({ transactionHash: DEPOSIT_TX });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it('shows the D8 disclosure and exact-amount approval copy', async () => {
    backend.escrow = null;
    backend.escrowError = 'ESCROW_NOT_FOUND';
    render(<EscrowPanel claim={claim('active_hold') as never} onUpdate={vi.fn()} />);
    expect(await screen.findByText('Pay with USDT on Polygon')).toBeTruthy();
    expect(await screen.findByText('Exact amount only — never unlimited')).toBeTruthy();
  });
});

describe('VerifyDepositBox', () => {
  it('calls onFunded on {status:funded}', async () => {
    backend.verify = { status: 'funded' };
    const onFunded = vi.fn();
    render(<VerifyDepositBox claimId={CLAIM_ID} onFunded={onFunded} />);
    await waitFor(() => expect(onFunded).toHaveBeenCalledTimes(1));
  });

  it('shows mismatch copy without funding on {status:mismatch}', async () => {
    backend.verify = { status: 'mismatch', reason: 'amount' };
    const onFunded = vi.fn();
    render(<VerifyDepositBox claimId={CLAIM_ID} onFunded={onFunded} />);
    expect(await screen.findByText("Deposit doesn't match.")).toBeTruthy();
    expect(onFunded).not.toHaveBeenCalled();
  });
});

describe('ConfirmReceiptBox', () => {
  it('fires confirm-receipt and reaches released', async () => {
    const user = userEvent.setup();
    backend.confirm = { status: 'released' };
    const onUpdate = vi.fn();
    render(
      <ConfirmReceiptBox claimId={CLAIM_ID} escrow={escrowRow('delivered') as never} onUpdate={onUpdate} />,
    );
    await user.click(screen.getByText('Confirm receipt'));
    expect(await screen.findByText('Released. Complete.')).toBeTruthy();
    expect(onUpdate).toHaveBeenCalled();
  });

  it('polls an in-flight release to released', async () => {
    backend.confirm = { status: 'released', confirmations: 3 };
    const onUpdate = vi.fn();
    render(
      <ConfirmReceiptBox
        claimId={CLAIM_ID}
        escrow={escrowRow('delivered', { release_tx_hash: DEPOSIT_TX }) as never}
        onUpdate={onUpdate}
      />,
    );
    expect(await screen.findByText('Released. Complete.')).toBeTruthy();
    expect(onUpdate).toHaveBeenCalled();
  });

  it('dispute: instruction → wallet send → disputed', async () => {
    const user = userEvent.setup();
    backend.dispute = {
      status: 'pending',
      disputeInstruction: { contractAddress: CONTRACT, onChainEscrowId: EID, callData: '0xadd98c70' },
    };
    const onUpdate = vi.fn();
    render(
      <ConfirmReceiptBox claimId={CLAIM_ID} escrow={escrowRow('delivered') as never} onUpdate={onUpdate} />,
    );
    await user.click(screen.getByText('Dispute'));
    expect(await screen.findByText('Send dispute transaction')).toBeTruthy();
    backend.dispute = { status: 'disputed' };
    await user.click(screen.getByText('Send dispute transaction'));
    await waitFor(() => expect(evm.sendTransaction).toHaveBeenCalledTimes(1));
    expect(evm.sendTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: CONTRACT, data: '0xadd98c70', gas: '0x186a0' }),
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });
});

describe('escrow badges + cards', () => {
  const labels: Array<[string, string]> = [
    ['deposit_submitted', 'Deposit submitted'],
    ['escrow_funded', 'In escrow'],
    ['delivered', 'Delivered'],
    ['disputed', 'Disputed'],
    ['releasing', 'Releasing'],
    ['released', 'Released'],
    ['refunding', 'Refunding'],
    ['refunded', 'Refunded'],
  ];

  for (const [status, label] of labels) {
    it(`badge renders "${label}" for ${status}`, () => {
      const { unmount } = render(<ClaimStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    });
  }

  it('card links to the escrow for escrow statuses, to the hold otherwise', () => {
    const { unmount } = render(
      <MemoryRouter>
        <ClaimCard claim={claim('delivered') as never} />
      </MemoryRouter>,
    );
    expect(screen.getByText('View escrow')).toBeTruthy();
    unmount();
    const second = render(
      <MemoryRouter>
        <ClaimCard claim={claim('active_hold') as never} />
      </MemoryRouter>,
    );
    expect(second.getByText('View hold')).toBeTruthy();
    second.unmount();
  });
});

describe('EscrowPanel contact-note display (P2, render-what-it-gets)', () => {
  function panelWithNote(note: string | null): void {
    backend.escrow = escrowRow('funded');
    backend.escrowError = null;
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith(`/claims/${CLAIM_ID}/escrow`)) {
          return jsonResponse({
            data: {
              escrow: escrowRow('funded'),
              claim: { ...claim('escrow_funded'), provider_contact_note: note },
            },
          });
        }
        return (original as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
    );
  }

  it('renders a non-null note under the status', async () => {
    panelWithNote('Meet at the side entrance and ask for Maria.');
    render(<EscrowPanel claim={claim('escrow_funded') as never} onUpdate={vi.fn()} />);
    expect(await screen.findByText('Provider contact')).toBeTruthy();
    expect(
      await screen.findByText('Meet at the side entrance and ask for Maria.'),
    ).toBeTruthy();
  });

  it('hides the note block when null', async () => {
    panelWithNote(null);
    render(<EscrowPanel claim={claim('escrow_funded') as never} onUpdate={vi.fn()} />);
    expect(await screen.findByText('Funds in escrow. Waiting for provider.')).toBeTruthy();
    expect(screen.queryByText('Provider contact')).toBeNull();
  });
});

describe('MarkDeliveredForm', () => {
  const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('rejects a malformed address client-side without fetching', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url));
        return (original as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
    );
    render(<MarkDeliveredForm claimId={CLAIM_ID} onDelivered={vi.fn()} />);
    await user.type(screen.getByLabelText(/payout address/i), 'not-an-address');
    await user.click(screen.getByText('Mark delivered'));
    expect(await screen.findByText(/valid payout address/i)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('submits the trimmed address body and shows delivered', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/mark-delivered')) {
          bodies.push(init?.body !== undefined ? JSON.parse(String(init.body)) : undefined);
          return jsonResponse({
            data: { escrow: escrowRow('delivered'), claim: claim('delivered') },
          });
        }
        return (original as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
    );
    const onDelivered = vi.fn();
    render(<MarkDeliveredForm claimId={CLAIM_ID} onDelivered={onDelivered} />);
    await user.type(screen.getByLabelText(/payout address/i), `  ${PAYOUT}  `);
    await user.click(screen.getByText('Mark delivered'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ providerPayoutAddress: PAYOUT });
    expect(await screen.findByText('Marked delivered.')).toBeTruthy();
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('maps 409 CONFLICT to the immutability copy', async () => {
    const user = userEvent.setup();
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/mark-delivered')) {
          return errorEnvelope('CONFLICT', 409);
        }
        return (original as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
    );
    render(<MarkDeliveredForm claimId={CLAIM_ID} onDelivered={vi.fn()} />);
    await user.type(screen.getByLabelText(/payout address/i), PAYOUT);
    await user.click(screen.getByText('Mark delivered'));
    expect(await screen.findByText(/can’t be changed after delivery/i)).toBeTruthy();
  });
});

describe('SlotForm contact note field', () => {
  function validInitial(note: string): SlotFormValues {
    return {
      title: 'Table for two',
      description: '',
      category: '',
      location_label: '',
      starts_at: '2030-01-01T10:00',
      ends_at: '',
      price: '1',
      total_quantity: '2',
      provider_contact_note: note,
    };
  }

  it('validateContactNote mirrors the server rules (empty means unchanged)', () => {
    expect(validateContactNote('   ')).toBeNull();
    expect(validateContactNote('x'.repeat(501))).toMatch(/500/);
    expect(validateContactNote('see https://example.com/x')).toMatch(/Links/);
    expect(validateContactNote('visit WWW.example.com')).toMatch(/Links/);
    expect(validateContactNote('Meet at the side entrance.')).toBeNull();
  });

  it('renders the field with escrow-gated helper and a live count', () => {
    const { unmount } = render(
      <SlotForm
        initial={validInitial('')}
        submitLabel="Save changes"
        submitting={false}
        serverError={null}
        onSubmit={() => {}}
      />,
    );
    try {
      expect(screen.getByLabelText(/contact for the buyer/i)).toBeTruthy();
      expect(screen.getByText(/only once their claim is funded/i)).toBeTruthy();
      expect(screen.getByText('0/500 characters')).toBeTruthy();
    } finally {
      unmount();
    }
  });

  it('passes the trimmed note as the second submit arg', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(
      <SlotForm
        initial={validInitial('  Meet at gate B.  ')}
        submitLabel="Save changes"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect((onSubmit.mock.calls[0]?.[0] as Record<string, unknown>).title).toBe('Table for two');
      expect(onSubmit.mock.calls[0]?.[1]).toBe('Meet at gate B.');
    } finally {
      unmount();
    }
  });

  it('submits a null note when the field is empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(
      <SlotForm
        initial={validInitial('')}
        submitLabel="Save changes"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0]?.[1]).toBeNull();
    } finally {
      unmount();
    }
  });

  it('blocks URL-ish notes client-side without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(
      <SlotForm
        initial={validInitial('see https://x.example/y')}
        submitLabel="Save changes"
        submitting={false}
        serverError={null}
        onSubmit={onSubmit}
      />,
    );
    try {
      await user.click(screen.getByRole('button', { name: /save changes/i }));
      expect(await screen.findByText(/Links/)).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});

describe('SellDetail demand section (P2)', () => {
  const PUBLISHED_SLOT = {
    id: 'slot-9',
    title: 'Table for two',
    description: null,
    category: 'dining',
    location_label: 'Mitte',
    starts_at: new Date(Date.now() + 3600_000).toISOString(),
    ends_at: null,
    price_usdt: '1500000',
    total_quantity: 4,
    available_quantity: 3,
    status: 'published',
    published_at: new Date().toISOString(),
    providerDisplay: 'Bistro',
    payout_wallet: 'NQ0700000000000000000000000000000000',
    provider_contact_note: null,
  };

  function demandFetch(): void {
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/api/v1/slots/slot-9')) {
          return jsonResponse({ data: { slot: PUBLISHED_SLOT } });
        }
        if (href.endsWith('/me/slots/slot-9/claims')) {
          return jsonResponse({
            data: {
              claims: [
                {
                  id: 'claim-9',
                  quantity: 1,
                  status: 'escrow_funded',
                  claimed_at: new Date().toISOString(),
                  hold_expires_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  buyerDisplay: 'NQ07…0000',
                },
              ],
              counts: {},
            },
          });
        }
        if (href.endsWith('/claims/claim-9/escrow')) {
          return jsonResponse({
            data: { escrow: escrowRow('funded'), claim: claim('escrow_funded') },
          });
        }
        if (href.endsWith('/mark-delivered')) {
          return jsonResponse({ data: { escrow: escrowRow('delivered'), claim: claim('delivered') } });
        }
        return (original as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
    );
  }

  it('lists the funded claim with a Mark delivered form; delivering updates the row', async () => {
    const user = userEvent.setup();
    demandFetch();
    render(
      <MemoryRouter initialEntries={['/sell/slot-9']}>
        <Routes>
          <Route path="/sell/:slotId" element={<SellDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Demand')).toBeTruthy();
    expect(await screen.findByText('NQ07…0000')).toBeTruthy();
    const input = await screen.findByLabelText(/payout address/i);
    await user.type(input, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await user.click(screen.getByText('Mark delivered'));
    expect(await screen.findByText('Marked delivered.')).toBeTruthy();
  });
});
