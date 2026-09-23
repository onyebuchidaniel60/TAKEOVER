import type { PublicSlot } from '../lib/slots';
import SlotCard from './SlotCard';

// Feed entrance (design.md §4): opacity + translateY(8px), 200ms,
// 40ms stagger, capped at 8 cards. Cards past the cap render instantly
// (no animation class at all).
export default function SlotList({ slots }: { slots: PublicSlot[] }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Available slots">
      {slots.map((slot, index) =>
        index < 8 ? (
          <li key={slot.id} className="animate-feed-in" style={{ animationDelay: `${index * 40}ms` }}>
            <SlotCard slot={slot} />
          </li>
        ) : (
          <li key={slot.id}>
            <SlotCard slot={slot} />
          </li>
        ),
      )}
    </ul>
  );
}
