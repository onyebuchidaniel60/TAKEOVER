// Inline confirmation takes focus on open, Escape backs out,
// and focus returns to the trigger on close (shared dialog hook).
import { useDialogFocus } from '../lib/dialog-focus';

export default function CancelConfirmDialog({
  onConfirm,
  onDismiss,
  cancelling,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
  cancelling: boolean;
}) {
  const panelRef = useDialogFocus<HTMLDivElement>(true, onDismiss);
  return (
    <div
      ref={panelRef}
      className="rounded-xl border bg-surface-2 p-4 border-danger"
      role="alertdialog"
      aria-label="Confirm cancellation"
    >
      <p className="text-body font-semibold text-danger">Cancel this opening?</p>
      <p className="mt-1 text-body text-danger">
        It will disappear from the marketplace. This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={cancelling}
          className="min-h-touch rounded-lg bg-danger px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-danger focus-visible:ring-offset-surface"
        >
          {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={cancelling}
          className="min-h-touch rounded-lg border border-danger bg-surface px-4 py-2 text-body font-medium text-danger disabled:opacity-50"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
