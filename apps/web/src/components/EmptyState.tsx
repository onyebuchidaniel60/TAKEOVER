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
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center" role="status">
      <p className="text-base font-semibold tracking-[-0.01em]">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
