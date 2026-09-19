// Admin disable confirmation (users + slots). The reason is
// required (5–1000 chars, enforced server-side) and is stored on the audit
// event. Disabling never moves funds and cannot be undone from this UI.
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useDialogFocus } from '../lib/dialog-focus';

export default function DisableDialog({
  title,
  body,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  body: string;
  submitLabel: string;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (reason.trim().length < 5) {
      setError('Add a short reason (at least 5 characters).');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coal/60 p-4 dark:bg-coal/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-xl dark:bg-cocoa"
      >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">{title}</h2>
        <p className="mt-2 text-body text-taupe dark:text-drift">{body}</p>
        <label className="mt-4 block text-body font-medium text-taupe dark:text-khaki" htmlFor="disable-reason">
          Reason
        </label>
        <textarea
          id="disable-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Why is this being disabled?"
          className="mt-1 w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 text-body text-bark placeholder:text-muted dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:placeholder:text-drift"
        />
        {error ? (
          <p role="alert" className="mt-2 text-body text-clay dark:text-clayd">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-touch rounded-lg border border-borderwarm px-4 py-2 text-body font-medium text-taupe disabled:opacity-50 dark:border-rootedge dark:bg-cocoa dark:text-khaki"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-touch rounded-lg bg-claydeep px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 dark:bg-clayfilld"
          >
            {busy ? 'Disabling…' : submitLabel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
