// Buyer-facing USDT escrow panel, dispatch by escrow status.
//
// Visual language (design.md §8 — eight states, each unmistakable):
// funded/delivered/releasing/released carry lime (money working);
// disputed is the only warning use; refunding/refunded are neutral
// (a refund is the system working, not a failure). Amounts always in
// mono + tabular-nums, never behind a tap. State changes remount only
// the inner content (keyed by status, 200ms feed-in); the panel itself
// — and any wallet flow inside it — never remounts.
//
// Flow mechanics (approve → deposit → receipt → submit; polling
// cadences) are unchanged — only the visual states around them.
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Lock,
  Package,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import {
  ApiError,
  createEscrowIntent,
  fetchEscrow,
  submitDepositReference,
  type DepositInstruction,
  type EscrowView,
} from '../lib/escrow';
import {
  approve,
  deposit,
  ensureChain,
  getAccounts,
  getEthereumProvider,
  waitForReceipt,
} from '../lib/evm';
import { formatUsdt, type ClaimView } from '../lib/slots';
import ConfirmReceiptBox from './ConfirmReceiptBox';
import VerifyDepositBox from './VerifyDepositBox';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-escrow' }
  | { kind: 'ready'; escrow: EscrowView; contactNote: string | null }
  | { kind: 'error'; message: string };

/** Split "1.5 USDT" into a prominent mono amount + muted unit label. */
function splitAmount(formatted: string): { amount: string; unit: string } {
  const match = /^(.*)\s+([A-Za-z]+)$/.exec(formatted.trim());
  if (!match) return { amount: formatted, unit: '' };
  return { amount: match[1] ?? formatted, unit: match[2] ?? '' };
}

function AmountBlock({ baseUnits }: { baseUnits: string }) {
  const { amount, unit } = splitAmount(formatUsdt(baseUnits));
  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-display font-bold tabular-nums text-text">{amount}</span>
      {unit ? <span className="text-small font-medium text-muted">{unit}</span> : null}
    </p>
  );
}

interface StateChrome {
  Icon: typeof Clock;
  chip: string;
  title: string;
  subtitle: string | null;
  pulseDot: string | null;
}

// Icon + accent per state (design.md §8). Every state pairs icon with
// label and copy — color is never the only signal.
const STATE_CHROME: Record<string, StateChrome> = {
  created: {
    Icon: Clock,
    chip: 'bg-surface-2 text-muted',
    title: 'Waiting for payment',
    subtitle: null,
    pulseDot: null,
  },
  funded: {
    Icon: Lock,
    chip: 'bg-accent text-accent-ink',
    title: 'Held until delivery',
    subtitle: 'Waiting for the provider to deliver.',
    pulseDot: null,
  },
  delivered: {
    Icon: Package,
    chip: 'bg-accent text-accent-ink',
    title: 'Marked delivered',
    subtitle: 'The provider marked this delivered.',
    pulseDot: null,
  },
  disputed: {
    Icon: TriangleAlert,
    chip: 'bg-warning text-accent-ink',
    title: 'In review',
    subtitle: 'Waiting for admin review.',
    pulseDot: null,
  },
  releasing: {
    Icon: ArrowUp,
    chip: 'bg-accent text-accent-ink',
    title: 'Releasing to provider…',
    subtitle: null,
    pulseDot: 'bg-accent',
  },
  released: {
    Icon: Check,
    chip: 'bg-accent text-accent-ink',
    title: 'Released',
    subtitle: 'Payment released.',
    pulseDot: null,
  },
  refunding: {
    Icon: ArrowDown,
    chip: 'bg-surface-2 text-muted',
    title: 'Refunding to your wallet…',
    subtitle: null,
    pulseDot: 'bg-muted',
  },
  refunded: {
    Icon: Undo2,
    chip: 'bg-surface-2 text-muted',
    title: 'Refunded',
    subtitle: 'Refunded to your wallet.',
    pulseDot: null,
  },
};

function StateHeader({ status }: { status: string }) {
  const chrome = STATE_CHROME[status] ?? STATE_CHROME.created;
  if (!chrome) return null;
  const { Icon, chip, title, subtitle, pulseDot } = chrome;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${chip}`}
      >
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <h3 className="text-h3 font-semibold text-text">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-body text-muted">{subtitle}</p> : null}
      </div>
      {pulseDot ? (
        <span
          aria-hidden="true"
          className={`ml-auto h-2 w-2 shrink-0 rounded-full motion-safe:animate-pulse-soft ${pulseDot}`}
        />
      ) : null}
    </div>
  );
}

function staticDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function EscrowPanel({
  claim,
  onUpdate,
}: {
  claim: ClaimView;
  onUpdate: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const refresh = useCallback(() => {
    setLoad((current) => (current.kind === 'loading' ? current : { kind: 'loading' }));
    void fetchEscrow(claim.id)
      .then(({ escrow, claim: escrowClaim }) => {
        // Defensive: a malformed 200 without an escrow projection is treated
        // as "no escrow yet" (instruction step) rather than crashing.
        if (!escrow || typeof escrow.status !== 'string') {
          setLoad({ kind: 'no-escrow' });
          return;
        }
        // Render-what-it-gets: the backend gates note visibility;
        // a non-empty string renders, anything else hides.
        const contactNote =
          typeof escrowClaim?.provider_contact_note === 'string' &&
          escrowClaim.provider_contact_note !== ''
            ? escrowClaim.provider_contact_note
            : null;
        setLoad({ kind: 'ready', escrow, contactNote });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'ESCROW_NOT_FOUND') {
          setLoad({ kind: 'no-escrow' });
          return;
        }
        setLoad({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Something went wrong.',
        });
      });
  }, [claim.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpdate = (): void => {
    onUpdate();
    refresh();
  };

  if (load.kind === 'loading') {
    return (
      <div className="animate-pulse rounded-card border border-border bg-surface p-4" aria-hidden="true">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-surface-2" />
          <div className="flex-1">
            <div className="h-5 w-1/2 rounded bg-surface-2" />
            <div className="mt-1 h-3 w-2/3 rounded bg-surface-2" />
          </div>
        </div>
        <div className="mt-3 h-8 w-32 rounded bg-surface-2" />
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="rounded-card border border-border bg-surface p-4" aria-live="polite">
        <p className="text-body text-muted">{load.message}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-3 inline-flex min-h-touch items-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Try again
        </button>
      </div>
    );
  }
  if (load.kind === 'no-escrow') {
    return <InstructionStep claimId={claim.id} onSubmitted={handleUpdate} />;
  }
  const escrow = load.escrow;
  // Buyer-side contact note: the backend gates visibility; a non-null
  // note renders under the state, null hides. Plain block, not a nested
  // card. No re-gating here.
  const noteBlock =
    load.contactNote !== null ? (
      <div className="mt-4 border-t border-border pt-3">
        <p className="text-small font-medium uppercase tracking-wide text-muted">Provider contact</p>
        <p className="mt-1 text-body leading-relaxed text-text">{load.contactNote}</p>
      </div>
    ) : null;
  switch (escrow.status) {
    case 'created':
      return escrow.deposit_tx_hash ? (
        <PanelShell status={escrow.status} amount={escrow.amount_base_units}>
          <VerifyDepositBox claimId={claim.id} onFunded={handleUpdate} />
          {noteBlock}
        </PanelShell>
      ) : (
        <InstructionStep claimId={claim.id} onSubmitted={handleUpdate} />
      );
    case 'funded':
      return (
        <PanelShell status={escrow.status} amount={escrow.amount_base_units}>
          {staticDate(escrow.delivery_deadline) && (
            <p className="mt-3 font-mono text-body tabular-nums text-muted">
              Delivery expected by {staticDate(escrow.delivery_deadline)}.
            </p>
          )}
          {noteBlock}
        </PanelShell>
      );
    case 'delivered':
      return (
        <PanelShell status={escrow.status} amount={escrow.amount_base_units}>
          <ConfirmReceiptBox claimId={claim.id} escrow={escrow} onUpdate={handleUpdate} />
          {noteBlock}
        </PanelShell>
      );
    case 'disputed':
    case 'releasing':
    case 'released':
    case 'refunding':
    case 'refunded':
      return (
        <PanelShell status={escrow.status} amount={escrow.amount_base_units}>
          {noteBlock}
        </PanelShell>
      );
    default:
      return (
        <PanelShell status="created" amount={escrow.amount_base_units}>
          <p className="mt-3 text-body text-muted">Escrow status: {escrow.status}.</p>
          {noteBlock}
        </PanelShell>
      );
  }
}

// The panel card itself: surface, radius-card, state header, amount.
// Inner content remounts on status change (cross-fade); the section —
// and any wallet flow above it — never remounts.
function PanelShell({
  status,
  amount,
  children,
}: {
  status: string;
  amount: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4" aria-live="polite">
      <div key={status} className="animate-feed-in">
        <StateHeader status={status} />
        <AmountBlock baseUnits={amount} />
        {children}
      </div>
    </section>
  );
}

type FundStep = 'loading' | 'ready' | 'approving' | 'depositing' | 'submitting';

function InstructionStep({
  claimId,
  onSubmitted,
}: {
  claimId: string;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<FundStep>('loading');
  const [instruction, setInstruction] = useState<DepositInstruction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createEscrowIntent(claimId)
      .then(({ depositInstruction }) => {
        if (cancelled) return;
        if (
          !depositInstruction ||
          typeof depositInstruction.usdtAmount !== 'string' ||
          typeof depositInstruction.contractAddress !== 'string'
        ) {
          setError('Payment details are unavailable. Please try again.');
          setStep('ready');
          return;
        }
        setInstruction(depositInstruction);
        setStep('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setStep('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  const busy = step === 'approving' || step === 'depositing' || step === 'submitting';
  const busyLabel =
    step === 'submitting' ? 'Confirming…' : step === 'loading' ? 'Loading…' : 'Opening wallet…';
  const payLabel = instruction ? `Pay ${formatUsdt(instruction.usdtAmount)}` : 'Pay';

  const handlePay = (): void => {
    if (!instruction) return;
    const current = instruction;
    setError(null);
    void (async () => {
      try {
        setStep('approving');
        const provider = getEthereumProvider();
        await ensureChain(provider);
        const accounts = await getAccounts(provider);
        const from = accounts[0] as string;
        const approveHash = await approve(provider, {
          token: current.tokenAddress,
          spender: current.approveTo,
          amount: current.approveAmount,
          from,
        });
        await waitForReceipt(provider, approveHash);
        setStep('depositing');
        const depositHash = await deposit(provider, {
          contract: current.contractAddress,
          escrowId: current.onChainEscrowId,
          amount: current.usdtAmount,
          from,
        });
        await waitForReceipt(provider, depositHash);
        setStep('submitting');
        await submitDepositReference(claimId, depositHash);
        onSubmitted();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setStep('ready');
      }
    })();
  };

  return (
    <section className="rounded-card border border-border bg-surface p-4" aria-live="polite">
      <div className="animate-feed-in">
        <StateHeader status="created" />
        {instruction ? (
          <AmountBlock baseUnits={instruction.usdtAmount} />
        ) : (
          <div aria-hidden="true" className="mt-3 h-8 w-32 animate-pulse rounded bg-surface-2" />
        )}
        <p className="mt-3 text-body leading-relaxed text-text">
          {instruction ? `Pay ${formatUsdt(instruction.usdtAmount)} to hold this slot.` : 'Loading payment details…'}
        </p>
        {error ? (
          <p className="mt-2 text-body font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {step !== 'loading' && instruction ? (
          <button
            type="button"
            onClick={handlePay}
            disabled={busy}
            className="mt-3 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:scale-100 disabled:bg-surface-2 disabled:text-faint motion-reduce:transition-none"
          >
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint/30 border-t-text-faint"
                />
                {busyLabel}
              </>
            ) : (
              payLabel
            )}
          </button>
        ) : null}
      </div>
    </section>
  );
}
