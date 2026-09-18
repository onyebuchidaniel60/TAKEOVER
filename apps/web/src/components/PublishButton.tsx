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
  /** Phase 14g-1: idle label override (e.g. "Approve payment & publish"). */
  label?: string;
  /** Phase 14g-1: busy label override (e.g. "Paying…" / "Verifying…"). */
  busyLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || disabled}
      className="min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-body font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-stone-100 dark:text-stone-900 dark:focus-visible:ring-stone-200 dark:focus-visible:ring-offset-stone-900"
    >
      {publishing ? (busyLabel ?? 'Publishing…') : (label ?? 'Publish')}
    </button>
  );
}
