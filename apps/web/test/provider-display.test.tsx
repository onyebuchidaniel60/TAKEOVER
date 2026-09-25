// @vitest-environment jsdom
// ProviderDisplay must be visible on the slot
// card (feed) and the slot detail page — for the profile-name path AND the
// truncated-wallet fallback path. The field was already in the PublicSlot
// type but neither component rendered it.
import { screen } from '@testing-library/react';
import { renderWithClient } from './test-utils';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SlotCard from '../src/components/SlotCard';
import SlotDetail from '../src/components/SlotDetail';
import type { PublicSlot } from '../src/lib/slots';
import { slotFixture } from './a11y-helpers';

function cardSlot(display: string): PublicSlot {
  return slotFixture({ providerDisplay: display }) as unknown as PublicSlot;
}

describe('provider display (Item 2)', () => {
  it('SlotCard shows the profile display name', () => {
    renderWithClient(
      <MemoryRouter>
        <SlotCard slot={cardSlot('Sunrise Yoga')} />
      </MemoryRouter>,
    );
    expect(screen.getByText('By Sunrise Yoga')).toBeTruthy();
  });

  it('SlotCard shows the truncated-wallet fallback neutrally', () => {
    renderWithClient(
      <MemoryRouter>
        <SlotCard slot={cardSlot('NQ32…X8K1')} />
      </MemoryRouter>,
    );
    const line = screen.getByText('By NQ32…X8K1');
    expect(line).toBeTruthy();
    // Neutral presentation: no wallet/address jargon anywhere on the card.
    expect(line.textContent ?? '').not.toMatch(/wallet|address/i);
  });

  it('SlotDetail shows the profile display name', () => {
    renderWithClient(<SlotDetail slot={cardSlot('Sunrise Yoga')} />);
    expect(screen.getByText('By Sunrise Yoga')).toBeTruthy();
  });

  it('SlotDetail shows the truncated-wallet fallback neutrally', () => {
    renderWithClient(<SlotDetail slot={cardSlot('NQ32…X8K1')} />);
    const line = screen.getByText('By NQ32…X8K1');
    expect(line).toBeTruthy();
    expect(line.textContent ?? '').not.toMatch(/wallet|address/i);
  });
});
