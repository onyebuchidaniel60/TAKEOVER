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
    <div className="rounded-2xl border border-dashed border-hairline bg-cream p-8 text-center dark:border-rootline dark:bg-cocoa" role="status">
      <p className="text-h3 font-semibold text-bark dark:text-parchment">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-body leading-relaxed text-muted dark:text-drift">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
