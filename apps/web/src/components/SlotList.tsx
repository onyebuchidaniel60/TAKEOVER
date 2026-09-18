import type { PublicSlot } from '../lib/slots';
import SlotCard from './SlotCard';

export default function SlotList({ slots }: { slots: PublicSlot[] }) {
  return (
    <ul className="flex flex-col gap-4" aria-label="Available slots">
      {slots.map((slot, index) => (
        <li
          key={slot.id}
          className="animate-feed-in"
          style={index < 8 ? { animationDelay: `${index * 40}ms` } : undefined}
        >
          <SlotCard slot={slot} />
        </li>
      ))}
    </ul>
  );
}
