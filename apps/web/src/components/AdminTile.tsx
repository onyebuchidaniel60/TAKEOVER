// Phase 10: dashboard count tile (label + value + link to the section).
import { Link } from 'react-router-dom';

export default function AdminTile({
  label,
  value,
  to,
}: {
  label: string;
  value: number | null;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:border-stone-800 dark:bg-stone-900 dark:shadow-none dark:hover:shadow-none dark:focus-visible:ring-stone-200"
    >
      <p className="font-mono text-display font-bold tabular-nums text-slate-900 dark:text-stone-100">{value === null ? '…' : value}</p>
      <p className="mt-1 text-small text-slate-500 dark:text-stone-400">{label}</p>
    </Link>
  );
}
