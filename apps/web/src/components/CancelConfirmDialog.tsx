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
      className="rounded-xl border border-clayline bg-claywash p-4 dark:border-clayd dark:bg-claywashd"
      role="alertdialog"
      aria-label="Confirm cancellation"
    >
      <p className="text-body font-semibold text-clay dark:text-clayd">Cancel this opening?</p>
      <p className="mt-1 text-body text-clay dark:text-clayd">
        It will disappear from the marketplace. This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={cancelling}
          className="min-h-touch rounded-lg bg-claydeep px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 ring-offset-cream dark:bg-clayfilld dark:focus-visible:ring-clayd dark:focus-visible:ring-offset-cocoa"
        >
          {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={cancelling}
          className="min-h-touch rounded-lg border border-clay bg-cream px-4 py-2 text-body font-medium text-clay disabled:opacity-50 dark:border-clayd dark:bg-cocoa dark:text-clayd"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
