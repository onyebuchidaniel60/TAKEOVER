import type { PublicSlot } from '../lib/slots';
import SlotCard from './SlotCard';

export default function SlotList({ slots }: { slots: PublicSlot[] }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Available slots">
      {slots.map((slot) => (
        <li key={slot.id}>
          <SlotCard slot={slot} />
        </li>
      ))}
    </ul>
  );
}
