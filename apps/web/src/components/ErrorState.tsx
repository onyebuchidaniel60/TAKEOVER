// Load-failure state: neutral card, one pill CTA in the accent.
// Network errors are not destructive (design.md §8), so danger stays
// out of this component entirely.
export default function ErrorState({
  message = "Couldn't reach the server. Try again.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6 text-center" role="alert">
      <p className="text-h3 font-semibold text-text">Couldn’t load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-body text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-touch rounded-pill bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
