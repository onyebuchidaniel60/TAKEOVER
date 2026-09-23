// Dashboard count tile (label + value + link to the section).
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
      className="block rounded-xl border border-border bg-surface p-4 text-center shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-accent"
    >
      <p className="font-mono text-display font-bold tabular-nums text-text">{value === null ? '…' : value}</p>
      <p className="mt-1 text-small text-muted">{label}</p>
    </Link>
  );
}
