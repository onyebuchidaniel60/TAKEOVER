// Neutral empty state: one message, no illustration, generous padding.
// Defaults carry the feed copy (design.md §5); callers with their own
// context pass explicit title/body.
export default function EmptyState({
  title = 'Nothing available right now.',
  body = 'Check back soon.',
  action,
}: {
  title?: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-12 text-center" role="status">
      <p className="text-h3 font-semibold text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-body leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
