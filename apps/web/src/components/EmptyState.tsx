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
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-700 dark:bg-stone-900" role="status">
      <p className="text-h3 font-semibold text-slate-900 dark:text-stone-100">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-body leading-relaxed text-slate-500 dark:text-stone-400">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
