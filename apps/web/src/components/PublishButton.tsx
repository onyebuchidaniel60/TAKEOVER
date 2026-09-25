export default function PublishButton({
  onPublish,
  publishing,
  disabled,
  label,
  busyLabel,
}: {
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
  /** Idle label override (e.g. "Approve payment & publish"). */
  label?: string;
  /** Busy label override (e.g. "Paying…" / "Verifying…"). */
  busyLabel?: string;
}) {
  // Primary CTA of the draft page (Phase 5e): publishing is the goal,
  // so this is the largest interactive element — centered by the parent,
  // accent fill, larger type + padding than any other button on the page.
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || disabled}
      className="min-h-touch rounded-lg bg-accent px-8 py-3 text-h3 font-semibold text-accent-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-accent focus-visible:ring-offset-surface"
    >
      {publishing ? (busyLabel ?? 'Publishing…') : (label ?? 'Publish')}
    </button>
  );
}
