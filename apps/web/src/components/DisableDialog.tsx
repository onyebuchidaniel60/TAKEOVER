// Phase 10: admin disable confirmation (users + slots). The reason is
// required (5–1000 chars, enforced server-side) and is stored on the audit
// event. Disabling never moves funds and cannot be undone from this UI.
import { useState } from 'react';
import { ApiError } from '../lib/api';

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
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="disable-reason">
          Reason
        </label>
        <textarea
          id="disable-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Why is this being disabled?"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Disabling…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
