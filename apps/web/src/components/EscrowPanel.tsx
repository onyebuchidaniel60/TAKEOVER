// Buyer-facing USDT escrow panel, sub-component dispatch by
// escrow status. Fixed rail (D8 — no token selector; intent sends the
// literal 'USDT_POLYGON'). Instruction step: exact amount/contract/token
// from the server response (D7-B — nothing token-specific hardcoded),
// "Pay with USDT on Polygon" disclosure (D8), exact-amount approve then
// deposit through the wallet, receipt wait before advancing (no
// auto-retry of broadcasts). Contact-note display is P2 (not rendered).
import { useCallback, useEffect, useState } from 'react';
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
import type { ClaimView } from '../lib/slots';
import ConfirmReceiptBox from './ConfirmReceiptBox';
import VerifyDepositBox from './VerifyDepositBox';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-escrow' }
  | { kind: 'ready'; escrow: EscrowView; contactNote: string | null }
  | { kind: 'error'; message: string };

function formatUsdt(baseUnits: string): string {
  try {
    const value = BigInt(baseUnits);
    const whole = value / 1_000_000n;
    const frac = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return frac === '' ? `${whole.toString()} USDT` : `${whole.toString()}.${frac} USDT`;
  } catch {
    return `${baseUnits} USDT (base units)`;
  }
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
      <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
        <p className="text-body text-taupe dark:text-drift">Loading escrow status…</p>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
        <p className="text-body text-clay dark:text-clayd">{load.message}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-2 inline-flex min-h-touch items-center rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-bark dark:border-rootedge dark:bg-cocoa dark:text-parchment"
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
  // Buyer-side contact note (P2): the backend gates visibility;
  // a non-null note renders under the status, null hides. No re-gating here.
  const noteBlock =
    load.contactNote !== null ? (
      <div className="mt-3 rounded-lg border border-hairline bg-cream p-3 dark:border-rootline dark:bg-cocoa">
        <p className="text-body font-medium text-bark dark:text-parchment">Provider contact</p>
        <p className="mt-1 text-body text-taupe dark:text-drift">{load.contactNote}</p>
      </div>
    ) : null;
  switch (escrow.status) {
    case 'created':
      return escrow.deposit_tx_hash ? (
        <VerifyDepositBox claimId={claim.id} onFunded={handleUpdate} />
      ) : (
        <InstructionStep claimId={claim.id} onSubmitted={handleUpdate} />
      );
    case 'funded':
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body font-medium text-bark dark:text-parchment">Funds in escrow. Waiting for provider.</p>
          {staticDate(escrow.delivery_deadline) && (
            <p className="mt-1 font-mono text-body tabular-nums text-taupe dark:text-drift">
              Delivery expected by {staticDate(escrow.delivery_deadline)}.
            </p>
          )}
          {noteBlock}
        </div>
      );
    case 'delivered':
      return (
        <>
          <ConfirmReceiptBox claimId={claim.id} escrow={escrow} onUpdate={handleUpdate} />
          {noteBlock}
        </>
      );
    case 'disputed':
      return (
        <div className="mt-4 rounded-lg bg-ochrewash p-3 dark:bg-ochrewashd" aria-live="polite">
          <p className="text-body font-medium text-ochre dark:text-ochred">Dispute open. Admin will resolve.</p>
          {noteBlock}
        </div>
      );
    case 'releasing':
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body text-taupe dark:text-drift">Releasing to provider…</p>
          {noteBlock}
        </div>
      );
    case 'released':
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body font-medium text-bark dark:text-parchment">Released. Complete.</p>
          {noteBlock}
        </div>
      );
    case 'refunding':
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body text-taupe dark:text-drift">Refunding to you…</p>
        </div>
      );
    case 'refunded':
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body font-medium text-bark dark:text-parchment">Refunded. Complete.</p>
        </div>
      );
    default:
      return (
        <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
          <p className="text-body text-taupe dark:text-drift">Escrow status: {escrow.status}.</p>
        </div>
      );
  }
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
  const [busyLabel, setBusyLabel] = useState('');

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

  const handlePay = (): void => {
    if (!instruction) return;
    const current = instruction;
    setError(null);
    void (async () => {
      try {
        setStep('approving');
        setBusyLabel('Waiting for wallet approval… (1 of 2: approve USDT)');
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
        setBusyLabel('Waiting for wallet approval… (2 of 2: deposit into escrow)');
        const depositHash = await deposit(provider, {
          contract: current.contractAddress,
          escrowId: current.onChainEscrowId,
          amount: current.usdtAmount,
          from,
        });
        await waitForReceipt(provider, depositHash);
        setStep('submitting');
        setBusyLabel('Recording deposit…');
        await submitDepositReference(claimId, depositHash);
        onSubmitted();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setStep('ready');
        setBusyLabel('');
      }
    })();
  };

  return (
    <div className="mt-4 rounded-lg bg-sand p-3 dark:bg-umber" aria-live="polite">
      <p className="text-body font-medium text-bark dark:text-parchment">Pay with USDT on Polygon</p>
      {step === 'loading' && <p className="mt-1 text-body text-taupe dark:text-drift">Loading payment details…</p>}
      {instruction && (
        <dl className="mt-2 space-y-1 text-body text-taupe dark:text-drift">
          <div className="flex justify-between gap-2">
            <dt>Amount</dt>
            <dd className="font-mono font-medium tabular-nums text-bark dark:text-parchment">{formatUsdt(instruction.usdtAmount)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Escrow contract</dt>
            <dd className="break-all font-mono text-small">{instruction.contractAddress}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Approval</dt>
            <dd>Exact amount only — never unlimited</dd>
          </div>
        </dl>
      )}
      {error && <p className="mt-2 text-body text-clay dark:text-clayd">{error}</p>}
      {step !== 'loading' && instruction && (
        <button
          type="button"
          onClick={handlePay}
          disabled={step === 'approving' || step === 'depositing' || step === 'submitting'}
          className="mt-3 inline-flex min-h-touch items-center rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 dark:bg-sandlight dark:text-coal"
        >
          {step === 'ready' ? 'Approve & Deposit' : busyLabel || 'Working…'}
        </button>
      )}
    </div>
  );
}
