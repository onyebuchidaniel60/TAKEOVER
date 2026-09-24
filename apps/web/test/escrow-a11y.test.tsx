// @vitest-environment jsdom
// Axe-core over the escrow + fee
// components. Zero critical/serious violations allowed (same bar as
// a11y-routes). Follows the a11y-helpers harness (mockFetch, fixtures).
// Interactive checks: every control named, validation announced via
// role=alert, busy/disabled states exposed as text, tab order sane.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmReceiptBox from '../src/components/ConfirmReceiptBox';
import EscrowPanel from '../src/components/EscrowPanel';
import MarkDeliveredForm from '../src/components/MarkDeliveredForm';
import PublishButton from '../src/components/PublishButton';
import SlotForm, { initialValues } from '../src/components/SlotForm';
import VerifyDepositBox from '../src/components/VerifyDepositBox';
import {
  assertZeroCriticalOrSerious,
  claimFixture,
  runAxe,
  setBuyer,
  type AxeTriage,
} from './a11y-helpers';

const CLAIM_ID = 'claim-1';

// NOTE: the shared mockFetch envelope treats any object with a `status`
// key as { status, json }, which collides with the escrow result shapes
// ({ status: 'pending', ... }). This suite stubs fetch directly with full
// envelopes instead (escrow-ui.test.tsx precedent).
function stubApi(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const payload = handler(String(url), init);
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'errorStatus' in payload
      ) {
        const { errorStatus, code, message } = payload as {
          errorStatus: number;
          code: string;
          message: string;
        };
        return {
          ok: false,
          status: errorStatus,
          headers: { get: () => null },
          json: async () => ({ error: { code, message }, requestId: 'test-request' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: payload }),
      };
    }) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function escrowView(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'escrow-1',
    claim_id: CLAIM_ID,
    buyer_id: 'buyer-1',
    payment_token: 'USDT_POLYGON',
    amount_base_units: '1500000',
    status,
    contract_address: '0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06',
    on_chain_escrow_id: '0xescrowid',
    deposit_tx_hash: status === 'created' ? null : '0xdeposithash',
    funded_at: status === 'created' ? null : new Date().toISOString(),
    delivery_deadline: new Date(Date.now() + 86400_000).toISOString(),
    provider_payout_address: null,
    delivered_at: null,
    dispute_window_ends: new Date(Date.now() + 86400_000).toISOString(),
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

function escrowClaim(note: string | null = null): Record<string, unknown> {
  return { ...claimFixture(), id: CLAIM_ID, provider_contact_note: note };
}

async function checkAxe(label: string, container: HTMLElement): Promise<void> {
  const triage: AxeTriage = await runAxe(container);
  assertZeroCriticalOrSerious(triage, label);
}

describe('EscrowPanel across all 8 escrow states', () => {
  const states = [
    'created',
    'funded',
    'delivered',
    'disputed',
    'releasing',
    'released',
    'refunding',
    'refunded',
  ] as const;

  for (const status of states) {
    it(`renders ${status} with zero critical/serious violations`, async () => {
      setBuyer();
      stubApi((url: string) => {
        if (url.includes('/escrow-intent')) {
          return {
            escrow: escrowView('created'),
            claim: escrowClaim(),
            depositInstruction: {
              contractAddress: '0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06',
              tokenAddress: '0xC885e1eeD2A2f2215b756Fa04B89aAD1A27559dE',
              usdtAmount: '1500000',
              onChainEscrowId: '0xescrowid',
              approveTo: '0x7F8F66E1e07372dc371edf8F21d2d84208a4Fc06',
              approveAmount: '1500000',
              buyerWallet: '0xbuyer',
            },
          };
        }
        if (url.includes('/verify-deposit')) {
          return { status: 'pending', escrow: escrowView('created'), claim: escrowClaim() };
        }
        if (url.includes('/confirm-receipt')) {
          return { status: 'pending', escrow: escrowView('delivered'), claim: escrowClaim() };
        }
        if (url.includes(`/api/v1/claims/${CLAIM_ID}/escrow`)) {
          const note = ['funded', 'delivered', 'disputed', 'releasing', 'released'].includes(status)
            ? 'Call me at the door.'
            : null;
          return { escrow: escrowView(status), claim: escrowClaim(note) };
        }
        throw new Error('unexpected fetch: ' + url);
      });
      const { container } = render(
        <EscrowPanel claim={escrowClaim() as never} onUpdate={() => {}} />,
      );
      // Settles past the loading state into the status branch.
      await waitFor(() => {
        expect(screen.queryByText('Loading escrow status…')).toBeNull();
      });
      await checkAxe(`escrow-panel-${status}`, container);
    });
  }

  it('exposes the funded contact note as plain text (no interactive trap)', async () => {
    setBuyer();
    stubApi((url: string) => {
      if (url.includes(`/api/v1/claims/${CLAIM_ID}/escrow`)) {
        return { escrow: escrowView('funded'), claim: escrowClaim('Call me at the door.') };
      }
      throw new Error('unexpected fetch: ' + url);
    });
    const { container } = render(
      <EscrowPanel claim={escrowClaim() as never} onUpdate={() => {}} />,
    );
    expect(await screen.findByText('Provider contact')).toBeDefined();
    expect(screen.getByText('Call me at the door.')).toBeDefined();
    await checkAxe('escrow-panel-funded-note', container);
  });
});

describe('VerifyDepositBox', () => {
  it('announces confirming state with progress, no manual button yet', async () => {
    setBuyer();
    stubApi((url: string) => {
      if (url.includes('/verify-deposit')) {
        return { status: 'pending', escrow: escrowView('created'), claim: escrowClaim() };
      }
      throw new Error('unexpected fetch: ' + url);
    });
    const { container } = render(<VerifyDepositBox claimId={CLAIM_ID} onFunded={() => {}} />);
    expect(await screen.findByText('Confirming payment…')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await checkAxe('verify-deposit-box-pending', container);
  });

  it('announces mismatch copy with a Try-again action, never another payment', async () => {
    setBuyer();
    stubApi((url: string) => {
      if (url.includes('/verify-deposit')) {
        return { status: 'mismatch', reason: 'amount', escrow: escrowView('created'), claim: escrowClaim() };
      }
      throw new Error('unexpected fetch: ' + url);
    });
    const { container } = render(<VerifyDepositBox claimId={CLAIM_ID} onFunded={() => {}} />);
    expect(await screen.findByText("We couldn't confirm your payment. Try again.")).toBeDefined();
    expect(screen.getByText(/do not pay again/)).toBeDefined();
    const manual = screen.getByRole('button', { name: 'Try again' });
    expect(manual instanceof HTMLButtonElement).toBe(true);
    await checkAxe('verify-deposit-box-mismatch', container);
  });
});

describe('ConfirmReceiptBox', () => {
  function deliveredEscrow(): Record<string, unknown> {
    return escrowView('delivered');
  }

  it('labels confirm + dispute actions and keeps both keyboard-focusable', async () => {
    setBuyer();
    stubApi(() => { throw new Error('unexpected fetch'); });
    const { container } = render(
      <ConfirmReceiptBox claimId={CLAIM_ID} escrow={deliveredEscrow() as never} onUpdate={() => {}} />,
    );
    const confirm = await screen.findByRole('button', { name: 'Confirm receipt' });
    const dispute = screen.getByRole('button', { name: 'Something wrong? Dispute this.' });
    expect(confirm instanceof HTMLButtonElement).toBe(true);
    expect(dispute instanceof HTMLButtonElement).toBe(true);
    // Tab order: confirm before dispute (primary action first).
    const user = userEvent.setup();
    (document.body as HTMLElement).focus();
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Confirm receipt');
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Dispute this.');
    await checkAxe('confirm-receipt-box-idle', container);
  });

  it('confirms the dispute in a dialog before any wallet call', async () => {
    setBuyer();
    stubApi((url: string) => {
      if (url.includes('/dispute')) {
        return new Promise(() => {});
      }
      throw new Error('unexpected fetch: ' + url);
    });
    const { container } = render(
      <ConfirmReceiptBox claimId={CLAIM_ID} escrow={deliveredEscrow() as never} onUpdate={() => {}} />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Something wrong? Dispute this.' }));
    expect(await screen.findByRole('dialog', { name: 'Open dispute' })).toBeDefined();
    expect(screen.getByText(/Disputes are resolved by an admin/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Open dispute' }));
    expect(await screen.findByRole('button', { name: 'Opening…' })).toBeDefined();
    await checkAxe('confirm-receipt-box-disputing', container);
  });

  it('closes the dispute dialog on Keep waiting with no wallet call', async () => {
    setBuyer();
    let disputeCalls = 0;
    stubApi((url: string) => {
      if (url.includes('/dispute')) {
        disputeCalls += 1;
        return new Promise(() => {});
      }
      throw new Error('unexpected fetch: ' + url);
    });
    render(
      <ConfirmReceiptBox claimId={CLAIM_ID} escrow={deliveredEscrow() as never} onUpdate={() => {}} />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Something wrong? Dispute this.' }));
    await screen.findByRole('dialog', { name: 'Open dispute' });
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(disputeCalls).toBe(0);
  });
});

describe('MarkDeliveredForm', () => {
  it('associates the address label and announces validation via role=alert', async () => {
    setBuyer();
    stubApi(() => { throw new Error('unexpected fetch'); });
    const { container } = render(<MarkDeliveredForm claimId={CLAIM_ID} onDelivered={() => {}} />);
    const input = screen.getByLabelText('Provider payout address (Polygon)');
    expect(input instanceof HTMLInputElement).toBe(true);
    const user = userEvent.setup();
    await user.type(input as HTMLInputElement, 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('0x followed by 40 hex characters');
    await checkAxe('mark-delivered-form-validation', container);
  });
});

describe('SlotForm contact note field', () => {
  it('labels the textarea, announces the char count, and alerts on links', async () => {
    setBuyer();
    stubApi(() => { throw new Error('unexpected fetch'); });
    const { container } = render(
      <SlotForm
        initial={{ ...initialValues(), title: 'T', starts_at: '2030-01-01T10:00', price: '1', total_quantity: '1' }}
        submitLabel="Save draft"
        submitting={false}
        serverError={null}
        onSubmit={() => {}}
      />,
    );
    const area = screen.getByLabelText('Contact for the buyer');
    expect(area instanceof HTMLTextAreaElement).toBe(true);
    expect(screen.getByText('0/500 characters')).toBeDefined();
    const describedBy = (area as HTMLTextAreaElement).getAttribute('aria-describedby');
    expect(describedBy).toContain('slot-contact-note-count');
    const user = userEvent.setup();
    await user.type(area as HTMLTextAreaElement, 'see https://example.com/x');
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Links and URLs');
    await checkAxe('slot-form-contact-note', container);
  });

  it('locks commercial fields but keeps the note editable in locked mode', async () => {
    setBuyer();
    stubApi(() => { throw new Error('unexpected fetch'); });
    const { container } = render(
      <SlotForm
        initial={{ ...initialValues(), title: 'T', starts_at: '2030-01-01T10:00', price: '1', total_quantity: '1' }}
        submitLabel="Save note"
        submitting={false}
        serverError={null}
        onSubmit={() => {}}
        commercialLocked
        onSubmitNote={() => {}}
      />,
    );
    expect((screen.getByLabelText('Title *') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Contact for the buyer') as HTMLTextAreaElement).disabled).toBe(false);
    await checkAxe('slot-form-note-locked', container);
  });
});

describe('PublishButton fee states', () => {
  it('keeps an accessible name in every fee label state, including disabled', async () => {
    const { container, rerender } = render(<PublishButton onPublish={() => {}} publishing={false} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDefined();
    rerender(
      <PublishButton onPublish={() => {}} publishing={false} label="Approve payment & publish" />,
    );
    expect(screen.getByRole('button', { name: 'Approve payment & publish' })).toBeDefined();
    rerender(
      <PublishButton
        onPublish={() => {}}
        publishing={true}
        label="Approve payment & publish"
        busyLabel="Paying…"
      />,
    );
    const busy = screen.getByRole('button', { name: 'Paying…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    rerender(
      <PublishButton onPublish={() => {}} publishing={false} disabled label="Approve payment & publish" />,
    );
    const off = screen.getByRole('button', { name: 'Approve payment & publish' }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    await checkAxe('publish-button-fee-states', container);
  });
});
