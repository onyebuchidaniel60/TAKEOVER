export default function EmptyState({
  title = 'Nothing available right now',
  body = 'Try a different search, or check back soon — new openings appear all the time.',
  action,
}: {
  title?: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center" role="status">
      <p className="text-h3 font-semibold text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-body leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
