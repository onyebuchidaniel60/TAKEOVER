// Phase 14e P1: buyer-facing USDT escrow panel, sub-component dispatch by
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
  | { kind: 'ready'; escrow: EscrowView }
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
      .then(({ escrow }) => {
        // Defensive: a malformed 200 without an escrow projection is treated
        // as "no escrow yet" (instruction step) rather than crashing.
        if (!escrow || typeof escrow.status !== 'string') {
          setLoad({ kind: 'no-escrow' });
          return;
        }
        setLoad({ kind: 'ready', escrow });
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
      <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
        <p className="text-sm text-slate-600">Loading escrow status…</p>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
        <p className="text-sm text-red-700">{load.message}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-2 inline-flex min-h-touch items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
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
  switch (escrow.status) {
    case 'created':
      return escrow.deposit_tx_hash ? (
        <VerifyDepositBox claimId={claim.id} onFunded={handleUpdate} />
      ) : (
        <InstructionStep claimId={claim.id} onSubmitted={handleUpdate} />
      );
    case 'funded':
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm font-medium text-slate-900">Funds in escrow. Waiting for provider.</p>
          {staticDate(escrow.delivery_deadline) && (
            <p className="mt-1 text-sm text-slate-600">
              Delivery expected by {staticDate(escrow.delivery_deadline)}.
            </p>
          )}
        </div>
      );
    case 'delivered':
      return <ConfirmReceiptBox claimId={claim.id} escrow={escrow} onUpdate={handleUpdate} />;
    case 'disputed':
      return (
        <div className="mt-4 rounded-lg bg-amber-50 p-3" aria-live="polite">
          <p className="text-sm font-medium text-amber-900">Dispute open. Admin will resolve.</p>
        </div>
      );
    case 'releasing':
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm text-slate-600">Releasing to provider…</p>
        </div>
      );
    case 'released':
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm font-medium text-slate-900">Released. Complete.</p>
        </div>
      );
    case 'refunding':
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm text-slate-600">Refunding to you…</p>
        </div>
      );
    case 'refunded':
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm font-medium text-slate-900">Refunded. Complete.</p>
        </div>
      );
    default:
      return (
        <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
          <p className="text-sm text-slate-600">Escrow status: {escrow.status}.</p>
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
    <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
      <p className="text-sm font-medium text-slate-900">Pay with USDT on Polygon</p>
      {step === 'loading' && <p className="mt-1 text-sm text-slate-600">Loading payment details…</p>}
      {instruction && (
        <dl className="mt-2 space-y-1 text-sm text-slate-600">
          <div className="flex justify-between gap-2">
            <dt>Amount</dt>
            <dd className="font-medium text-slate-900">{formatUsdt(instruction.usdtAmount)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Escrow contract</dt>
            <dd className="break-all">{instruction.contractAddress}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Approval</dt>
            <dd>Exact amount only — never unlimited</dd>
          </div>
        </dl>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {step !== 'loading' && instruction && (
        <button
          type="button"
          onClick={handlePay}
          disabled={step === 'approving' || step === 'depositing' || step === 'submitting'}
          className="mt-3 inline-flex min-h-touch items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {step === 'ready' ? 'Approve & Deposit' : busyLabel || 'Working…'}
        </button>
      )}
    </div>
  );
}
