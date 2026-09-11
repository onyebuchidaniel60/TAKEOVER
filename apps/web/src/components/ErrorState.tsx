export default function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center" role="alert">
      <p className="text-base font-semibold text-red-900">Couldn’t load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-red-800">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-[44px] rounded-lg bg-red-900 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
