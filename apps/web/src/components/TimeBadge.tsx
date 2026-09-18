// "Today / Tomorrow / date" label plus exact time. Consumer language.
function dayLabel(when: Date, now: Date): string {
  const day = (d: Date): string => d.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (day(when) === day(now)) return 'Today';
  if (day(when) === day(tomorrow)) return 'Tomorrow';
  return when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

import { Clock } from 'lucide-react';

export default function TimeBadge({ startsAt, endsAt }: { startsAt: string; endsAt: string | null }) {
  const when = new Date(startsAt);
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const end = endsAt
    ? new Date(endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium tabular-nums text-amber-900">
      <Clock size={12} aria-hidden="true" />
      {dayLabel(when, new Date())} · {time}
      {end ? ` – ${end}` : ''}
    </span>
  );
}
