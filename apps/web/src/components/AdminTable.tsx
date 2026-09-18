// Phase 10: shared admin table shell (horizontal scroll on mobile, text
// labels alongside any status color so color is never the only indicator).
import type { ReactNode } from 'react';

export default function AdminTable({
  headers,
  children,
  label,
}: {
  headers: string[];
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:shadow-none">
      <table className="w-full min-w-admintable text-left text-body text-slate-900 dark:text-stone-100" aria-label={label}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-stone-800 dark:bg-stone-800">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-small font-semibold text-slate-500 dark:text-stone-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
