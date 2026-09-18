export default function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950" role="alert">
      <p className="text-h3 font-semibold text-red-900 dark:text-red-300">Couldn’t load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-body text-red-800 dark:text-red-300">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-touch rounded-lg bg-red-900 px-4 py-2 text-body font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2 dark:bg-red-800 dark:focus-visible:ring-red-400 dark:focus-visible:ring-offset-stone-900"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
