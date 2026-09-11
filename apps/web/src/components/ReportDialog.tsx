// Phase 10: buyer report dialog (opened from the slot detail page). Reports
// never notify the reported party and trigger no automatic action — an admin
// reviews them later.
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { createReport, REPORT_REASONS, type ReportReason } from '../lib/admin';

export default function ReportDialog({
  slotId,
  onClose,
  onReported,
}: {
  slotId: string;
  onClose: () => void;
  onReported: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('misleading');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createReport({
        slotId,
        reason,
        details: details.trim() ? details.trim() : undefined,
      });
      onReported();
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
      aria-label="Report this opening"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-bold">Report this opening</h2>
        <p className="mt-1 text-sm text-slate-600">
          An admin will review it. The provider is not notified.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="report-reason">
          Reason
        </label>
        <select
          id="report-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="report-details">
          Details (optional)
        </label>
        <textarea
          id="report-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What looks wrong?"
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
            className="min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </div>
  );
}
