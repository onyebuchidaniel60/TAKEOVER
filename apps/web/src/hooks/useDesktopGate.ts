import { useEffect, useState } from 'react';

// Desktop gate detection (Phase 4b correction 7).
//
// TAKEOVER runs inside Nimiq Pay (mobile-only): sign-in, claims, and
// payments all need the Nimiq Pay Mini App provider (`window.nimiq`,
// injected by the host and polled by the SDK — see lib/nimiq.ts and
// node_modules/@nimiq/mini-app-sdk/dist/index.js). A desktop browser
// without it gets a gate instead of a broken app.
//
// Returns:
// - 'in-app' — the provider exists (inside Nimiq Pay), OR the audit/dev
//   bypass `?desktop=1` is present. Show the app.
// - 'desktop' — no provider after a short grace period AND viewport
//   width >= 1024px. Show the gate.
// - 'mobile-browser' — no provider AND viewport < 1024px. Show the app
//   (the existing auth flow already handles the wallet-less case with
//   "Open this app inside Nimiq Pay to connect a wallet").
//
// First render defaults to 'in-app': the provider may arrive late (the
// SDK polls every 50ms), so the gate only appears after the check
// confirms desktop — never as a first-paint flash. The check re-runs
// on viewport crossing 1024px either way.
export type DesktopGateState = 'in-app' | 'desktop' | 'mobile-browser';

const DESKTOP_MIN_WIDTH = 1024;
// Long enough for a late-injected provider to appear (the SDK polls at
// 50ms), short enough that a real desktop visitor is gated promptly.
const PROVIDER_GRACE_MS = 500;

function hasProvider(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { nimiq?: unknown }).nimiq !== undefined;
}

function hasBypass(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('desktop');
}

function isDesktopWidth(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= DESKTOP_MIN_WIDTH;
}

function decide(provider: boolean, desktopWidth: boolean): DesktopGateState {
  if (provider) return 'in-app';
  return desktopWidth ? 'desktop' : 'mobile-browser';
}

export function useDesktopGate(): DesktopGateState {
  // Show the app until the check says otherwise (see above).
  const [state, setState] = useState<DesktopGateState>('in-app');

  useEffect(() => {
    if (hasBypass()) {
      setState('in-app');
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      setState(decide(hasProvider(), isDesktopWidth()));
    };
    // Re-check on a fast tick until the grace period ends: a provider
    // injected just after paint flips the verdict back to 'in-app'.
    const tick = window.setInterval(() => {
      if (hasProvider()) {
        window.clearInterval(tick);
        window.clearTimeout(grace);
        unlisten();
        settled = true;
        setState('in-app');
      }
    }, 50);
    const grace = window.setTimeout(() => {
      window.clearInterval(tick);
      unlisten();
      finish();
    }, PROVIDER_GRACE_MS);
    // Re-evaluate when the viewport crosses the desktop boundary —
    // matchMedia where available, resize fallback otherwise (jsdom).
    let unlisten: () => void = () => {};
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
      const onChange = (): void => {
        window.clearInterval(tick);
        window.clearTimeout(grace);
        unlisten();
        finish();
      };
      media.addEventListener('change', onChange);
      unlisten = () => media.removeEventListener('change', onChange);
    } else {
      const onResize = (): void => {
        window.clearInterval(tick);
        window.clearTimeout(grace);
        unlisten();
        finish();
      };
      window.addEventListener('resize', onResize);
      unlisten = () => window.removeEventListener('resize', onResize);
    }
    return () => {
      settled = true;
      window.clearInterval(tick);
      window.clearTimeout(grace);
      unlisten();
    };
  }, []);

  return state;
}
