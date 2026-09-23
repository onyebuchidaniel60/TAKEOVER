// Category identity per D5: one lucide icon per slot type, rendered in
// a circular chip on the card. Exact-match table over the canonical
// SLOT_CATEGORIES plus the legacy short values already in the DB
// (the server accepts any string); anything else falls back to Tag.
// The chip is decorative — the card title carries the meaning — so the
// icon is aria-hidden and the wrapper carries the category label only
// when no visible category text accompanies it (the feed card shows
// the icon alone).
import { Dumbbell, Scissors, Tag, Ticket, Trophy, Utensils } from 'lucide-react';

const ICONS: Record<string, typeof Tag> = {
  'Restaurant / food': Utensils,
  dining: Utensils,
  'Fitness / class': Dumbbell,
  fitness: Dumbbell,
  'Sports court': Trophy,
  sports: Trophy,
  'Salon / service': Scissors,
  beauty: Scissors,
  Event: Ticket,
  events: Ticket,
};

export function categoryIconLabel(category: string | null): string {
  return category ?? 'Uncategorized';
}

export default function CategoryIcon({
  category,
  size = 20,
}: {
  category: string | null;
  size?: number;
}) {
  const Icon = (category !== null && ICONS[category]) || Tag;
  return (
    <span
      role="img"
      aria-label={categoryIconLabel(category)}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
    >
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
