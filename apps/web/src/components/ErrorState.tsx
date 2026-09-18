export default function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-clayline bg-claywash p-6 text-center dark:border-clayd dark:bg-claywashd" role="alert">
      <p className="text-h3 font-semibold text-clay dark:text-clayd">Couldn’t load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-body text-clay dark:text-clayd">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-touch rounded-lg bg-claydeep px-4 py-2 text-body font-medium text-ivory focus:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 ring-offset-cream dark:bg-clayfilld dark:focus-visible:ring-clayd dark:focus-visible:ring-offset-cocoa"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
