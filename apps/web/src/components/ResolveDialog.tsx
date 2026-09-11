// Phase 10: generic admin resolve dialog (reports + payment reviews).
// Resolution notes are required (5–1000 chars, enforced server-side).
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useDialogFocus } from '../lib/dialog-focus';

export default function ResolveDialog({
  title,
  actions,
  warning,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  actions: { value: string; label: string }[];
  warning?: string;
  submitLabel: string;
  onSubmit: (body: { action: string; resolutionNotes: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [action, setAction] = useState(actions[0]?.value ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (notes.trim().length < 5) {
      setError('Add a short note (at least 5 characters).');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ action, resolutionNotes: notes.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h2 className="text-lg font-bold">{title}</h2>
        {warning ? (
          <p role="note" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {warning}
          </p>
        ) : null}
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="resolve-action">
          Outcome
        </label>
        <select
          id="resolve-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {actions.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="resolve-notes">
          Resolution note
        </label>
        <textarea
          id="resolve-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="What did you decide and why?"
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
            className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
