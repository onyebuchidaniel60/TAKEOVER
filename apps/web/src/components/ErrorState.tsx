export default function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border bg-surface-2 p-6 text-center border-danger" role="alert">
      <p className="text-h3 font-semibold text-danger">Couldn’t load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-body text-danger">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-touch rounded-lg bg-danger px-4 py-2 text-body font-medium text-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 ring-offset-surface focus-visible:ring-danger focus-visible:ring-offset-surface"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
