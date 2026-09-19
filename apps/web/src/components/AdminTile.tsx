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
      className="block rounded-xl border border-hairline bg-cream p-4 text-center shadow-sm transition hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-terra dark:border-rootline dark:bg-cocoa dark:shadow-none dark:hover:shadow-none dark:focus-visible:ring-terralight"
    >
      <p className="font-mono text-display font-bold tabular-nums text-bark dark:text-parchment">{value === null ? '…' : value}</p>
      <p className="mt-1 text-small text-muted dark:text-drift">{label}</p>
    </Link>
  );
}
