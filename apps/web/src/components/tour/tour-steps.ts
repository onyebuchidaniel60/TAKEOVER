// Product tour stops (Phase 5j-2). Selectors target stable hooks that
// already exist — no DOM changes were needed (the STOP-condition check
// passed: BottomNav items carry aria-labels, the feed section has
// #openings, cards are links to /slot/*).
//
// Copy is consumer language (no "escrow", no chain words), one idea per
// stop, reading like a friend showing the app.
export interface TourStop {
  id: 'feed' | 'card' | 'sell' | 'profile';
  /** CSS selector for the highlight target. First match wins. */
  selector: string;
  title: string;
  body: string;
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'feed',
    selector: 'section#openings',
    title: 'Your feed',
    body: 'Every opening that\u2019s available right now, soonest first.',
  },
  {
    id: 'card',
    selector: 'section#openings a[href^="/slot/"]',
    title: 'Openings open fast',
    body: 'Tap any opening to see the details, then claim it.',
  },
  {
    id: 'sell',
    selector: 'nav[aria-label="Primary"] a[aria-label="Sell"]',
    title: 'Release your own',
    body: 'Got capacity to release? List it here in under a minute.',
  },
  {
    id: 'profile',
    selector: 'nav[aria-label="Primary"] a[aria-label="Profile"]',
    title: 'Your corner',
    body: 'Your profile, your claims, your settings \u2014 all here.',
  },
];

/**
 * Resolve stops to visible targets, skipping absent ones (e.g. no cards
 * in an empty feed). Pure over a document — unit-tested with jsdom.
 * Visibility = connected, not display:none/visibility:hidden, non-zero
 * rect (tests stub getBoundingClientRect, which is all-zero in jsdom).
 */
export function resolveTourStops(stops: TourStop[], doc: Document): TourStop[] {
  return stops.filter((stop) => {
    const el = doc.querySelector(stop.selector);
    if (!(el instanceof HTMLElement)) {
      return false;
    }
    if (!el.isConnected) {
      return false;
    }
    const style = doc.defaultView?.getComputedStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
