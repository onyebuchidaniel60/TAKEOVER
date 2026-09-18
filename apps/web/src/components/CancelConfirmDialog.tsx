// Phase 11: inline confirmation takes focus on open, Escape backs out,
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
      className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
      role="alertdialog"
      aria-label="Confirm cancellation"
    >
      <p className="text-body font-semibold text-red-900 dark:text-red-300">Cancel this opening?</p>
      <p className="mt-1 text-body text-red-800 dark:text-red-300">
        It will disappear from the marketplace. This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={cancelling}
          className="min-h-touch rounded-lg bg-red-900 px-4 py-2 text-body font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2 dark:bg-red-800 dark:focus-visible:ring-red-400 dark:focus-visible:ring-offset-stone-900"
        >
          {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={cancelling}
          className="min-h-touch rounded-lg border border-red-300 bg-white px-4 py-2 text-body font-medium text-red-900 disabled:opacity-50 dark:border-red-600 dark:bg-stone-900 dark:text-red-300"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
