// @vitest-environment jsdom
// 1 Polish tests: token layer values, TopBar mobile alignment,
// and feed badge rendering. Structural asserts only — no pixels.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - tailwind.config.js is untyped JS; values asserted below
import tailwindConfig from '../tailwind.config.js';
import AvailabilityBadge from '../src/components/AvailabilityBadge';
import PriceDisplay from '../src/components/PriceDisplay';
import TimeBadge from '../src/components/TimeBadge';
import TopBar from '../src/components/TopBar';

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
    const { container } = render(
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
    const { container } = render(<TimeBadge startsAt="2030-06-12T18:00:00.000Z" endsAt={null} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent).not.toContain('●');
    expect(container.textContent).toContain('Jun');
  });

  it('AvailabilityBadge covers all four tiers as text', () => {
    const { container, rerender } = render(<AvailabilityBadge available={0} />);
    expect(container.textContent).toBe('Sold out');
    rerender(<AvailabilityBadge available={1} />);
    expect(container.textContent).toBe('Only 1 left');
    rerender(<AvailabilityBadge available={3} />);
    expect(container.textContent).toBe('Only 3 left');
    rerender(<AvailabilityBadge available={9} />);
    expect(container.textContent).toBe('9 available');
  });

  it('PriceDisplay uses tabular numerals with size tracking', () => {
    const { container } = render(<PriceDisplay priceUsdt="1500000" large />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('tabular-nums');
    expect(screen.getByLabelText(/price/i)).toBeTruthy();
  });
});
