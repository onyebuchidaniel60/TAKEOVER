export default function CancelConfirmDialog({
  onConfirm,
  onDismiss,
  cancelling,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
  cancelling: boolean;
}) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-4"
      role="alertdialog"
      aria-label="Confirm cancellation"
    >
      <p className="text-sm font-semibold text-red-900">Cancel this opening?</p>
      <p className="mt-1 text-sm text-red-800">
        It will disappear from the marketplace. This cannot be undone.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={cancelling}
          className="min-h-[44px] rounded-lg bg-red-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2"
        >
          {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={cancelling}
          className="min-h-[44px] rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 disabled:opacity-50"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
