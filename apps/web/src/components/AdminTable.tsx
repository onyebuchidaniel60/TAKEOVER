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
    <div className="overflow-x-auto rounded-xl border border-hairline bg-cream shadow-sm dark:border-rootline dark:bg-cocoa dark:shadow-none">
      <table className="w-full min-w-admintable text-left text-body text-bark dark:text-parchment" aria-label={label}>
        <thead>
          <tr className="border-b border-hairline bg-sand dark:border-rootline dark:bg-umber">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-small font-semibold text-muted dark:text-drift">
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
