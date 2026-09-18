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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-stone-900"
      >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h2 className="text-h2 font-bold text-slate-900 dark:text-stone-100">{title}</h2>
        {warning ? (
          <p role="note" className="mt-2 rounded-lg bg-amber-50 p-3 text-body text-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {warning}
          </p>
        ) : null}
        <label className="mt-4 block text-body font-medium text-slate-700 dark:text-stone-300" htmlFor="resolve-action">
          Outcome
        </label>
        <select
          id="resolve-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-body text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-100 dark:focus-visible:ring-stone-200"
        >
          {actions.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-body font-medium text-slate-700 dark:text-stone-300" htmlFor="resolve-notes">
          Resolution note
        </label>
        <textarea
          id="resolve-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="What did you decide and why?"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-body text-slate-900 placeholder:text-slate-400 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
        {error ? (
          <p role="alert" className="mt-2 text-body text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-body font-medium text-slate-700 disabled:opacity-50 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-body font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          >
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
