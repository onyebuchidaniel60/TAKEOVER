// Phase 14e P1: confirm-receipt + dispute box for a delivered escrow.
// Confirm: POST confirm-receipt broadcasts the server-signed release, then
// the box polls GET /escrow on the plan cadence (15 s, cap 24) until the
// rows flip to released. Dispute (USDT): POST dispute returns the
// server-encoded callData until the buyer broadcasts dispute(escrowId)
// from their own wallet; re-polling dispute then flips both rows to
// disputed for admin resolution. Contact-note display is P2 (not here).
import { useEffect, useState } from 'react';
import {
  ApiError,
  CONFIRM_RECEIPT_INTERVAL_MS,
  CONFIRM_RECEIPT_MAX_ATTEMPTS,
  confirmReceipt,
  nextEscrowPollDelayMs,
  raiseDispute,
  type EscrowView,
} from '../lib/escrow';
import {
  ensureChain,
  getAccounts,
  getEthereumProvider,
  sendTransaction,
} from '../lib/evm';

type Display = 'idle' | 'confirming' | 'pending' | 'released' | 'rpc-down' | 'exhausted';

export default function ConfirmReceiptBox({
  claimId,
  escrow,
  onUpdate,
}: {
  claimId: string;
  escrow: EscrowView;
  onUpdate: () => void;
}) {
  const [display, setDisplay] = useState<Display>(
    escrow.release_tx_hash ? 'pending' : 'idle',
  );
  const [confirmations, setConfirmations] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [disputeCallData, setDisputeCallData] = useState<string | null>(null);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  // Receipt polling chain: runs while a release broadcast is in flight.
  useEffect(() => {
    if (display !== 'pending') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let autoAttempts = 0;

    const schedule = (delayMs: number): void => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      autoAttempts += 1;
      try {
        const result = await confirmReceipt(claimId);
        if (cancelled) return;
        if (result.status === 'released') {
          setDisplay('released');
          onUpdate();
          return;
        }
        if (typeof result.confirmations === 'number') {
          setConfirmations(result.confirmations);
        }
        if (autoAttempts >= CONFIRM_RECEIPT_MAX_ATTEMPTS) {
          setDisplay('exhausted');
          return;
        }
        schedule(CONFIRM_RECEIPT_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 503 || err.code === 'ESCROW_RELEASE_FAILED')) {
          setDisplay('rpc-down');
          const delay = nextEscrowPollDelayMs('rpc-unavailable', CONFIRM_RECEIPT_INTERVAL_MS);
          if (delay !== null) schedule(delay);
          return;
        }
        if (err instanceof ApiError && err.code === 'CLAIM_NOT_PAYABLE') {
          onUpdate();
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setDisplay('idle');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // One polling chain per broadcast; refresh via onUpdate re-mounts state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId, display === 'pending']);

  const handleConfirm = (): void => {
    setError(null);
    setDisplay('confirming');
    void confirmReceipt(claimId)
      .then((result) => {
        if (result.status === 'released') {
          setDisplay('released');
          onUpdate();
          return;
        }
        if (typeof result.confirmations === 'number') {
          setConfirmations(result.confirmations);
        }
        setDisplay('pending');
        onUpdate();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setDisplay('idle');
      });
  };

  const handleDispute = (): void => {
    setDisputeError(null);
    setDisputeBusy(true);
    void raiseDispute(claimId)
      .then((result) => {
        if (result.status === 'disputed') {
          onUpdate();
          return;
        }
        setDisputeCallData(result.disputeInstruction?.callData ?? null);
        setDisputing(true);
      })
      .catch((err: unknown) => {
        setDisputeError(err instanceof ApiError ? err.message : 'Something went wrong.');
      })
      .finally(() => setDisputeBusy(false));
  };

  const handleDisputeSend = (): void => {
    if (!disputeCallData || !escrow.contract_address) return;
    setDisputeError(null);
    setDisputeBusy(true);
    void (async () => {
      try {
        const provider = getEthereumProvider();
        await ensureChain(provider);
        const accounts = await getAccounts(provider);
        const from = accounts[0] as string;
        await sendTransaction(provider, {
          from,
          to: escrow.contract_address as string,
          data: disputeCallData,
        });
        // Broadcast done — the Disputed event lands on-chain; re-poll flips state.
        const result = await raiseDispute(claimId);
        if (result.status === 'disputed') {
          onUpdate();
          return;
        }
        setDisputeError('Dispute sent. It can take a moment to confirm — try again shortly.');
      } catch (err) {
        setDisputeError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setDisputeBusy(false);
      }
    })();
  };

  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3" aria-live="polite">
      <p className="text-sm font-medium text-slate-900">Service delivered?</p>
      {escrow.dispute_window_ends && (
        <p className="mt-1 text-sm text-slate-600">
          Dispute window closes{' '}
          {new Date(escrow.dispute_window_ends).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          .
        </p>
      )}
      {display === 'pending' && (
        <p className="mt-1 text-sm text-slate-600">
          Release in progress
          {confirmations !== null ? ` (${confirmations}/3 confirmations)` : ''}…
        </p>
      )}
      {display === 'released' && (
        <p className="mt-1 text-sm font-medium text-slate-900">Released. Complete.</p>
      )}
      {display === 'rpc-down' && (
        <p className="mt-1 text-sm text-slate-600">
          Release status is temporarily unavailable. We&apos;ll keep checking.
        </p>
      )}
      {display === 'exhausted' && (
        <p className="mt-1 text-sm text-slate-600">
          Still pending. The release may need more time — confirm again.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      {(display === 'idle' || display === 'exhausted') && (
        <button
          type="button"
          onClick={handleConfirm}
          className="mt-2 inline-flex min-h-touch items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Confirm receipt
        </button>
      )}
      {display === 'confirming' && (
        <p className="mt-2 text-sm text-slate-600">Confirming…</p>
      )}
      <div className="mt-3 border-t border-slate-200 pt-3">
        {!disputing ? (
          <button
            type="button"
            onClick={handleDispute}
            disabled={disputeBusy}
            className="inline-flex min-h-touch items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
          >
            {disputeBusy ? 'Opening dispute…' : 'Dispute'}
          </button>
        ) : (
          <div>
            <p className="text-sm text-slate-600">
              To open the dispute, send the dispute transaction from your wallet, then come back.
            </p>
            <button
              type="button"
              onClick={handleDisputeSend}
              disabled={disputeBusy}
              className="mt-2 inline-flex min-h-touch items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
            >
              {disputeBusy ? 'Waiting for wallet…' : 'Send dispute transaction'}
            </button>
          </div>
        )}
        {disputeError && <p className="mt-1 text-sm text-red-700">{disputeError}</p>}
      </div>
    </div>
  );
}
