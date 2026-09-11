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
      className="block rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
    >
      <p className="text-2xl font-bold">{value === null ? '…' : value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </Link>
  );
}
