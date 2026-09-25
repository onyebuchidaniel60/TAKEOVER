// @vitest-environment jsdom
// 1 Polish tests: token layer values, TopBar mobile alignment,
// and feed badge rendering. Structural asserts only — no pixels.
import { screen, within } from '@testing-library/react';
import { renderWithClient } from './test-utils';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - tailwind.config.js is untyped JS; values asserted below
import tailwindConfig from '../tailwind.config.js';
import AvailabilityBadge from '../src/components/AvailabilityBadge';
import CategoryIcon from '../src/components/CategoryIcon';
import EmptyState from '../src/components/EmptyState';
import ErrorState from '../src/components/ErrorState';
import PriceDisplay from '../src/components/PriceDisplay';
import SlotCard from '../src/components/SlotCard';
import SlotList from '../src/components/SlotList';
import TimeBadge from '../src/components/TimeBadge';
import TopBar from '../src/components/TopBar';
import type { PublicSlot } from '../src/lib/slots';

describe('design tokens', () => {
  it('pins the motion tokens (curves, sub-300ms durations, feed entrance)', () => {
    const theme = (
      tailwindConfig as unknown as {
        theme: {
          extend: Record<
            string,
            Record<string, string | Record<string, Record<string, string> | string>>
          >;
        };
      }
    ).theme.extend;
    expect(theme.transitionTimingFunction['out-strong']).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
    expect(theme.transitionTimingFunction['in-out']).toBe('cubic-bezier(0.77, 0, 0.175, 1)');
    expect(theme.transitionTimingFunction.drawer).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(theme.transitionDuration.press).toBe('120ms');
    expect(theme.transitionDuration.ui).toBe('200ms');
    expect(theme.transitionDuration.panel).toBe('280ms');
    expect(theme.boxShadow.card).toContain('rgb(0 0 0');
    expect(theme.boxShadow['card-hover']).toContain('rgb(0 0 0');
    expect(theme.animation['feed-in']).toContain('200ms');
    expect(theme.animation['feed-in']).toContain('cubic-bezier(0.23, 1, 0.32, 1)');
  });
});

describe('chrome alignment', () => {
  it('TopBar is sticky and matches page padding on mobile', () => {
    const { container } = renderWithClient(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );
    const header = container.querySelector('header');
    expect(header?.className).toContain('sticky');
    const inner = header?.querySelector('div');
    expect(inner?.className).toContain('px-4');
    expect(inner?.className).not.toMatch(/(^|\s)px-6(\s|$)/);
  });
});

describe('feed badges', () => {
  it('TimeBadge renders a clock icon instead of the dot glyph', () => {
    const { container } = renderWithClient(<TimeBadge startsAt="2030-06-12T18:00:00.000Z" endsAt={null} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toContain('●');
    expect(container.textContent).toContain('Jun');
  });

  it('AvailabilityBadge covers all four tiers as text', () => {
    const { container, rerender } = renderWithClient(<AvailabilityBadge available={0} />);
    expect(container.textContent).toBe('Sold out');
    rerender(<AvailabilityBadge available={1} />);
    expect(container.textContent).toBe('Only 1 left');
    rerender(<AvailabilityBadge available={3} />);
    expect(container.textContent).toBe('Only 3 left');
    rerender(<AvailabilityBadge available={9} />);
    expect(container.textContent).toBe('9 available');
  });

  it('PriceDisplay uses tabular numerals with size tracking', () => {
    const { container } = renderWithClient(<PriceDisplay priceUsdt="1500000" large />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('tabular-nums');
    // The exposed text is the accessible name (no aria-label wrapper).
    expect(screen.getByText('1.5 USDT')).toBeTruthy();
  });
});

function cardFixture(overrides: Partial<PublicSlot> = {}): PublicSlot {
  return {
    id: 'slot-1',
    title: 'Table for two — tonight',
    description: 'A cozy corner table.',
    category: 'dining',
    location_label: 'Mitte',
    starts_at: '2030-06-12T18:00:00.000Z',
    ends_at: null,
    price_usdt: '1500000',
    total_quantity: 4,
    available_quantity: 3,
    status: 'published',
    published_at: '2030-06-01T00:00:00.000Z',
    providerDisplay: 'Manual Bistro',
    ...overrides,
  };
}

function renderCard(slot: PublicSlot = cardFixture()) {
  return renderWithClient(
    <MemoryRouter>
      <SlotCard slot={slot} />
    </MemoryRouter>,
  );
}

describe('feed card', () => {
  it('renders category chip, h2 title, time, price, and availability as one link', () => {
    const { container } = renderCard();
    const link = container.querySelector('a') as HTMLElement;
    expect(link?.getAttribute('href')).toBe('/slot/slot-1');
    // Surface card, no shadow, press feedback (whole card is tappable).
    expect(link?.className).toContain('rounded-card');
    expect(link?.className).toContain('bg-surface');
    expect(link?.className).not.toMatch(/shadow/);
    expect(link?.className).toContain('active:scale-[0.99]');
    // Category identity rides the icon chip.
    const card = within(link);
    expect(card.getByRole('img', { name: 'dining' })).toBeTruthy();
    expect(card.getByRole('heading', { level: 2, name: 'Table for two — tonight' })).toBeTruthy();
    expect(card.getByText('1.5 USDT')).toBeTruthy();
    expect(card.getByText('Only 3 left')).toBeTruthy();
  });

  it('maps each canonical category to its icon, unknown to Tag', () => {
    const { container, rerender } = renderWithClient(<CategoryIcon category="Restaurant / food" />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Restaurant / food' })).toBeTruthy();
    rerender(<CategoryIcon category="mystery" />);
    expect(screen.getByRole('img', { name: 'mystery' })).toBeTruthy();
    rerender(<CategoryIcon category={null} />);
    expect(screen.getByRole('img', { name: 'Uncategorized' })).toBeTruthy();
  });
});

describe('feed list motion', () => {
  it('staggers the first eight cards, renders the rest instantly', () => {
    const slots = Array.from({ length: 10 }, (_, i) => cardFixture({ id: `slot-${i}` }));
    const { container } = renderWithClient(
      <MemoryRouter>
        <SlotList slots={slots} />
      </MemoryRouter>,
    );
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(10);
    const list = container.querySelector('ul');
    expect(list?.className).toContain('gap-3');
    items.slice(0, 8).forEach((li, i) => {
      expect(li.className).toContain('animate-feed-in');
      expect((li as HTMLElement).style.animationDelay).toBe(`${i * 40}ms`);
    });
    expect(items[8]?.className).not.toContain('animate-feed-in');
    expect(items[9]?.className).not.toContain('animate-feed-in');
  });
});

describe('feed states', () => {
  it('empty carries the neutral spec copy', () => {
    const { container } = renderWithClient(<EmptyState />);
    expect(container.textContent).toContain('Nothing available right now.');
    expect(container.textContent).toContain('Check back soon.');
    expect(container.textContent).not.toMatch(/!/);
  });

  it('error uses the accent pill CTA, never danger', () => {
    const { container: err } = renderWithClient(<ErrorState onRetry={() => {}} />);
    expect(err.textContent).toContain("Couldn't reach the server. Try again.");
    const button = err.querySelector('button');
    expect(button?.className).toContain('bg-accent');
    expect(button?.className).toContain('rounded-pill');
    expect(err.innerHTML).not.toMatch(/danger/);
  });
});
