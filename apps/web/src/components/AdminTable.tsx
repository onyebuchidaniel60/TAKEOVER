// Shared admin table shell (horizontal scroll on mobile, text
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
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full min-w-admintable text-left text-body text-text" aria-label={label}>
        <thead>
          <tr className="border-b border-border bg-surface-2">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-small font-semibold text-muted">
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
