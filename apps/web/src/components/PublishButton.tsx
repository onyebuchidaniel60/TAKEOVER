export default function PublishButton({
  onPublish,
  publishing,
  disabled,
}: {
  onPublish: () => void;
  publishing: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || disabled}
      className="min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
    >
      {publishing ? 'Publishing…' : 'Publish'}
    </button>
  );
}
