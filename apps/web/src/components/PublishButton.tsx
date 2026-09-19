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
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || disabled}
      className="min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 ring-offset-cream dark:bg-sandlight dark:text-coal dark:focus-visible:ring-terralight dark:focus-visible:ring-offset-cocoa"
    >
      {publishing ? (busyLabel ?? 'Publishing…') : (label ?? 'Publish')}
    </button>
  );
}
