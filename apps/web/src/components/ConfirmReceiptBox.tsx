// Confirm-receipt + dispute actions for a delivered escrow. Lives inside
// the EscrowPanel card (no outer card of its own).
// Confirm: POST confirm-receipt broadcasts the server-signed release, then
// the box polls GET /escrow on the plan cadence (15 s, cap 24) until the
// rows flip to released. Dispute (USDT): a confirmation dialog first
// ("Are you sure? Disputes are resolved by an admin."), then POST dispute
// returns the server-encoded callData until the buyer broadcasts
// dispute(escrowId) from their own wallet; re-polling dispute then flips
// both rows to disputed for admin resolution. No reason textarea: the
// dispute endpoint takes no input (verified against
// apps/api/src/escrow/validation.ts). Contact-note display is P2
// (not here).
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
import { useDialogFocus } from '../lib/dialog-focus';
import {
  DISPUTE_GAS_LIMIT,
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
          setConfirmDialogOpen(false);
          onUpdate();
          return;
        }
        setDisputeCallData(result.disputeInstruction?.callData ?? null);
        setConfirmDialogOpen(false);
        setDisputing(true);
      })
      .catch((err: unknown) => {
        setConfirmDialogOpen(false);
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
          gas: DISPUTE_GAS_LIMIT,
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

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  return (
    <div className="mt-3" aria-live="polite">
      {escrow.dispute_window_ends && (
        <p className="font-mono text-body tabular-nums text-muted">
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
        <p className="mt-2 font-mono text-body tabular-nums text-muted">
          Release in progress
          {confirmations !== null ? ` (${confirmations}/3 confirmations)` : ''}…
        </p>
      )}
      {display === 'released' && (
        <p className="mt-2 text-body font-medium text-text">Released. Complete.</p>
      )}
      {display === 'rpc-down' && (
        <p className="mt-2 text-body text-muted">
          Release status is temporarily unavailable. We&apos;ll keep checking.
        </p>
      )}
      {display === 'exhausted' && (
        <p className="mt-2 text-body text-muted">
          Still pending. The release may need more time — confirm again.
        </p>
      )}
      {error && (
        <p className="mt-2 text-body font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {(display === 'idle' || display === 'exhausted') && (
        <button
          type="button"
          onClick={handleConfirm}
          className="mt-3 inline-flex min-h-touch w-full items-center justify-center rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Confirm receipt
        </button>
      )}
      {display === 'confirming' && (
        <button
          type="button"
          disabled
          className="mt-3 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-pill bg-surface-2 px-4 py-2 text-body font-medium text-faint"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint/30 border-t-text-faint"
          />
          Confirming…
        </button>
      )}
      <div className="mt-3 border-t border-border pt-3">
        {!disputing ? (
          <button
            type="button"
            onClick={() => setConfirmDialogOpen(true)}
            disabled={disputeBusy}
            className="inline-flex min-h-touch items-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:scale-100 disabled:opacity-50 motion-reduce:transition-none"
          >
            Something wrong? Dispute this.
          </button>
        ) : (
          <div>
            <p className="text-body text-muted">
              To open the dispute, send the dispute transaction from your wallet, then come back.
            </p>
            <button
              type="button"
              onClick={handleDisputeSend}
              disabled={disputeBusy}
              className="mt-2 inline-flex min-h-touch items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:scale-100 disabled:bg-surface-2 disabled:text-faint motion-reduce:transition-none"
            >
              {disputeBusy ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint/30 border-t-text-faint"
                  />
                  Waiting for wallet…
                </>
              ) : (
                'Send dispute transaction'
              )}
            </button>
          </div>
        )}
        {disputeError && (
          <p className="mt-2 text-body font-medium text-danger" role="alert">
            {disputeError}
          </p>
        )}
      </div>
      {confirmDialogOpen ? (
        <DisputeConfirmDialog
          busy={disputeBusy}
          onKeepWaiting={() => setConfirmDialogOpen(false)}
          onOpenDispute={handleDispute}
        />
      ) : null}
    </div>
  );
}

// Disputes are legitimate features, not errors: neutral copy, no danger
// red anywhere in this dialog.
function DisputeConfirmDialog({
  busy,
  onKeepWaiting,
  onOpenDispute,
}: {
  busy: boolean;
  onKeepWaiting: () => void;
  onOpenDispute: () => void;
}) {
  const panelRef = useDialogFocus<HTMLDivElement>(true, onKeepWaiting);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4"
      onClick={onKeepWaiting}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Open dispute"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-card border border-border bg-surface p-5"
      >
        <h2 className="text-h2 font-bold text-text">Open dispute?</h2>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Are you sure? Disputes are resolved by an admin.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenDispute}
            disabled={busy}
            className="inline-flex min-h-touch items-center rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open dispute'}
          </button>
          <button
            type="button"
            onClick={onKeepWaiting}
            className="inline-flex min-h-touch items-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text"
          >
            Keep waiting
          </button>
        </div>
      </div>
    </div>
  );
}
