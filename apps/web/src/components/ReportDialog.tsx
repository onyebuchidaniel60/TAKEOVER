// Buyer report dialog (opened from the slot detail page). Reports
// never notify the reported party and trigger no automatic action — an admin
// reviews them later.
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { createReport, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '../lib/admin';
import { useDialogFocus } from '../lib/dialog-focus';

export default function ReportDialog({
  slotId,
  onClose,
  onReported,
}: {
  slotId: string;
  onClose: () => void;
  onReported: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('misleading_listing');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-coal/60 p-4 dark:bg-coal/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Report this opening"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-xl dark:bg-cocoa"
      >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">Report this opening</h2>
        <p className="mt-1 text-body text-taupe dark:text-drift">
          An admin will review it. The provider is not notified.
        </p>
        <label className="mt-4 block text-body font-medium text-taupe dark:text-khaki" htmlFor="report-reason">
          Reason
        </label>
        <select
          id="report-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="mt-1 min-h-touch w-full rounded-lg border border-borderwarm bg-cream px-3 py-2 text-body text-bark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra dark:border-rootedge dark:bg-cocoa dark:text-parchment dark:focus-visible:ring-terralight"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REPORT_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <label className="mt-4 block text-body font-medium text-taupe dark:text-khaki" htmlFor="report-details">
          Details (optional)
        </label>
        <textarea
          id="report-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What looks wrong?"
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
            className="min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 dark:bg-sandlight dark:text-coal"
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </div>
    </div>
  );
}
