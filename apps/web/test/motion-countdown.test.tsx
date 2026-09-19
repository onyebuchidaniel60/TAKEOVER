// @vitest-environment jsdom
// motion + countdown announcements: the stylesheet neutralizes
// animation under prefers-reduced-motion, and the hold countdown announces
// only at the 5 min / 1 min / 30s / 10s thresholds plus expiry — never
// every second.
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HoldCountdown from '../src/components/HoldCountdown';

// Stylesheet under test, resolved from the web workspace root.
const CSS = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('prefers-reduced-motion stylesheet', () => {
  it('neutralizes animations and transitions when requested', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    // The blanket rule neutralizes the loading shimmer (animate-pulse) and
    // card hover transitions alike.
    expect(block).toContain('*');
    expect(block).toContain('animation-duration');
    expect(block).toContain('transition-duration');
  });
});

describe('HoldCountdown announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function expiresIn(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
  }

  it('shows remaining time visually while the announcement stays static above 5 minutes', () => {
    render(<HoldCountdown holdExpiresAt={expiresIn(10 * 60_000)} />);
    expect(screen.getByText('Hold expires in 10:00')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Your hold is active.');
  });

  it('announces only when a threshold is crossed, not every second', () => {
    render(<HoldCountdown holdExpiresAt={expiresIn(10 * 60_000)} />);
    const live = () => screen.getByRole('status').textContent;
    const before = live();
    // A minute of ticking below no threshold changes nothing announced.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(live()).toBe(before);
    // Crossing 5 minutes announces once…
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 1000);
    });
    expect(live()).toBe('Hold expires in 5 minutes.');
    // …and the following minute of ticking changes nothing announced.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(live()).toBe('Hold expires in 5 minutes.');
  });

  it('walks 5 minutes, 1 minute, 30 seconds, 10 seconds, then expiry', () => {
    render(<HoldCountdown holdExpiresAt={expiresIn(61_000)} />);
    const live = () => screen.getByRole('status').textContent;
    // 61s sits in the 5-minute band until the 60s line is crossed.
    expect(live()).toBe('Hold expires in 5 minutes.');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(live()).toBe('Hold expires in 1 minute.');
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(live()).toBe('Hold expires in 30 seconds.');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(live()).toBe('Hold expires in 10 seconds.');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Hold expired')).toBeDefined();
    expect(live()).toBe('Hold expired.');
  });
});
