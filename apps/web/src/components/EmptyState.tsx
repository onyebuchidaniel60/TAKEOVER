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
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center" role="status">
      <p className="text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
