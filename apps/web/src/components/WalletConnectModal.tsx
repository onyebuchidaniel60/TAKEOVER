// Inline wallet connection (Phase 5n-A, D22).
//
// The rule this exists for: never dead-end a user on a hidden step. A
// wallet-less email user who taps "Claim" should be offered the wallet right
// THERE, with the claim resuming by itself afterwards — not a dead-end
// error, and not a hunt through the profile.
//
// Reuses the shared dialog-focus hook (Escape backs out, focus returns to
// the trigger) so it behaves like every other dialog in the app. Copy is
// consumer language: it says what the wallet is FOR, not that a signature
// is required.
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../lib/dialog-focus';

export default function WalletConnectModal({
  /** What the user was trying to do, e.g. "claim this slot". */
  action,
  onConnect,
  onDismiss,
  isConnecting,
  error,
}: {
  /** Present-tense gerund, e.g. "claim this slot". */
  action: string;
  onConnect: () => void;
  onDismiss: () => void;
  isConnecting: boolean;
  error: string | null;
}) {
  const panelRef = useDialogFocus<HTMLDivElement>(true, onDismiss);
  // Portalled to <body> on purpose: the claim CTA lives inside a FIXED
  // container, so an inline panel is clipped by it (measured — the dialog
  // overlapped the price card and the "1 left" badge). Bottom-anchored
  // above the nav so it still reads as attached to the button that opened it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end bg-bg/60 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+96px)]"
      // Clicking the scrim backs out; the panel stops the propagation.
      onClick={onDismiss}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-connect-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl rounded-card border border-border bg-surface-2 p-4"
      >
        <p id="wallet-connect-title" className="text-h3 font-semibold text-text">
          Connect your wallet to continue
        </p>
        <p className="mt-1 text-body text-muted">
          You need a wallet to {action}. It is the same wallet you sign in with
          Nimiq Pay — connecting just links it to your account.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-body font-medium text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="inline-flex min-h-touch items-center rounded-pill bg-accent px-5 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none"
          >
            {isConnecting ? 'Connecting…' : 'Connect wallet'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={isConnecting}
            className="min-h-touch rounded-pill border border-border-strong bg-surface px-5 py-2 text-body font-medium text-text disabled:opacity-60"
          >
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
