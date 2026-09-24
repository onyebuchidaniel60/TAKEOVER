// @vitest-environment jsdom
// Desktop gate (Phase 4b correction 7): detection states, gate
// content, and App mounting. jsdom has no matchMedia, so these
// exercise the resize-fallback path; real browsers use matchMedia
// (same verdict function).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import DesktopGate from '../src/components/DesktopGate';
import { useDesktopGate } from '../src/hooks/useDesktopGate';
import { mockFetch, runAxe, assertZeroCriticalOrSerious, setGuest } from './a11y-helpers';

const REAL_WIDTH = window.innerWidth;
const REAL_URL = window.location.href;

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

function setUrl(url: string): void {
  window.history.replaceState({}, '', url);
}

function clearProvider(): void {
  delete (window as unknown as { nimiq?: unknown }).nimiq;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearProvider();
  setUrl(REAL_URL);
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: REAL_WIDTH });
});

function Probe() {
  return <p data-testid="gate-state">{useDesktopGate()}</p>;
}

describe('useDesktopGate', () => {
  it('shows the app first, then gates a wide provider-less viewport', async () => {
    setWidth(1280);
    render(<Probe />);
    // First render never gates (the provider may arrive late).
    expect(screen.getByTestId('gate-state').textContent).toBe('in-app');
    await waitFor(
      () => expect(screen.getByTestId('gate-state').textContent).toBe('desktop'),
      { timeout: 3000 },
    );
  });

  it('keeps the app on a narrow provider-less viewport', async () => {
    setWidth(375);
    render(<Probe />);
    await waitFor(
      () => expect(screen.getByTestId('gate-state').textContent).toBe('mobile-browser'),
      { timeout: 3000 },
    );
  });

  it('shows the app when the provider exists, even when wide', async () => {
    setWidth(1440);
    (window as unknown as { nimiq?: unknown }).nimiq = {};
    render(<Probe />);
    await waitFor(
      () => expect(screen.getByTestId('gate-state').textContent).toBe('in-app'),
      { timeout: 3000 },
    );
  });

  it('honors the ?desktop=1 bypass on a wide viewport', async () => {
    setWidth(1280);
    setUrl('/?desktop=1');
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getByTestId('gate-state').textContent).toBe('in-app');
  });
});

describe('DesktopGate content', () => {
  it('explains Nimiq Pay with QR, manual URL, download, and footer', async () => {
    setUrl('/slot/slot-1');
    render(<DesktopGate />);
    expect(await screen.findByText('Mobile only')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /TAKEOVER runs inside Nimiq Pay/i })).toBeTruthy();
    expect(screen.getByText(/mobile wallet for Nimiq/i)).toBeTruthy();
    // QR renders locally as SVG (no network): one svg, inside the card.
    expect(document.querySelector('svg')).toBeTruthy();
    expect(screen.getByText(/scan with your phone camera/i)).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/slot/slot-1`)).toBeTruthy();
    expect(screen.getByText(/Mini Apps → Custom URL/i)).toBeTruthy();
    const download = screen.getByRole('link', { name: /get Nimiq Pay/i });
    expect(download.getAttribute('href')).toBe('https://nimpay.app/');
    expect(screen.getByText(/Built for Nimiq Pay · MIT licensed/i)).toBeTruthy();
  });

  it('has no critical/serious axe violations', async () => {
    setUrl('/');
    const { container } = render(<DesktopGate />);
    await screen.findByRole('heading', { name: /TAKEOVER runs inside Nimiq Pay/i });
    const triage = await runAxe(container);
    assertZeroCriticalOrSerious(triage, 'desktop gate');
  });
});

describe('App gate mounting', () => {
  it('renders the gate (not the app) on desktop without the bypass', async () => {
    setGuest();
    setWidth(1280);
    mockFetch(() => ({ slots: [], total: 0, limit: 12, offset: 0 }));
    render(<App />);
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: /TAKEOVER runs inside Nimiq Pay/i })).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('renders the app on desktop with ?desktop=1', async () => {
    setGuest();
    setWidth(1280);
    setUrl('/?desktop=1');
    mockFetch(() => ({ slots: [], total: 0, limit: 12, offset: 0 }));
    render(<App />);
    // Generous wait: the Home route chunk loads asynchronously.
    await screen.findByText(/nothing available right now/i, undefined, { timeout: 5000 });
    expect(screen.queryByRole('heading', { name: /TAKEOVER runs inside Nimiq Pay/i })).toBeNull();
  });

  it('renders the app on mobile widths', async () => {
    setGuest();
    setWidth(375);
    mockFetch(() => ({ slots: [], total: 0, limit: 12, offset: 0 }));
    render(<App />);
    await screen.findByText(/nothing available right now/i, undefined, { timeout: 5000 });
    expect(screen.queryByRole('heading', { name: /TAKEOVER runs inside Nimiq Pay/i })).toBeNull();
  });
});
