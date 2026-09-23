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
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 p-4 bg-bg/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl"
      >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h2 className="text-h2 font-bold text-text">{title}</h2>
        <p className="mt-2 text-body text-muted">{body}</p>
        <label className="mt-4 block text-body font-medium text-muted" htmlFor="disable-reason">
          Reason
        </label>
        <textarea
          id="disable-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Why is this being disabled?"
          className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-muted placeholder:text-muted"
        />
        {error ? (
          <p role="alert" className="mt-2 text-body text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-touch rounded-lg border border-border-strong px-4 py-2 text-body font-medium text-muted disabled:opacity-50 bg-surface"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-touch rounded-lg bg-danger px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
          >
            {busy ? 'Disabling…' : submitLabel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
