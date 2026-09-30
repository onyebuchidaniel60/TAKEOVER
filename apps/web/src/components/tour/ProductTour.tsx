// Coach-mark product tour overlay (Phase 5j-2). NOT a slideshow: a dimmed
// backdrop with a spotlight hole on the live element plus a popover.
//
// Spotlight technique: the highlight ring carries
// `box-shadow: 0 0 0 9999px rgba(10,10,10,0.7)` — the shadow IS the dim,
// so the target box itself stays undimmed with free rounded corners and
// zero mask/blur cost (Mini App WebView-safe: no backdrop-filter, no
// animated cutout — the ring snaps on scroll/resize). A full-screen
// transparent catcher underneath closes on tap; the ring is visual-only.
//
// Motion: backdrop fade + popover opacity/translateY entrance, 200ms
// ease-out-strong, transform/opacity only; everything collapses under the
// global prefers-reduced-motion blanket. Step changes remount the popover
// (key) so the entrance re-runs; the ring snaps.
//
// Accessibility: role="dialog" aria-modal, labelled by the step title;
// focus moves into the dialog on mount/step change; Tab is trapped to
// Next/Skip; Escape skips. Every control is min-h-touch.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveTourStops, type TourStop } from './tour-steps';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const RING_PAD = 6;

function measureTarget(selector: string): TargetRect | null {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  if (typeof el.scrollIntoView === 'function') {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export default function ProductTour({
  stops,
  onFinish,
  onSkip,
}: {
  stops: TourStop[];
  onFinish: () => void;
  onSkip: () => void;
}) {
  // Resolve once on mount: absent targets (e.g. no cards) are skipped.
  // Zero resolvable stops → complete silently via onFinish (avoids an
  // infinite retry loop; the feed section itself always resolves).
  const [active, setActive] = useState<TourStop[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const resolved = resolveTourStops(stops, document);
    if (resolved.length === 0) {
      onFinish();
      return;
    }
    setActive(resolved);
  }, [stops, onFinish]);

  const step = active?.[index] ?? null;
  const total = active?.length ?? 0;
  const last = active !== null && index >= active.length - 1;

  // Snap the ring to the current target; re-snap on scroll/resize.
  const snap = useCallback(() => {
    if (!step) {
      return;
    }
    const found = measureTarget(step.selector);
    if (found) {
      setRect(found);
    }
  }, [step]);

  useLayoutEffect(() => {
    snap();
    window.addEventListener('scroll', snap, { passive: true });
    window.addEventListener('resize', snap);
    return () => {
      window.removeEventListener('scroll', snap);
      window.removeEventListener('resize', snap);
    };
  }, [snap]);

  // Entrance on mount and every step change. Focus moves in via the
  // dialog's callback ref instead: on the first render the dialog is
  // not in the tree yet (rect is still null), so an effect keyed on
  // [index, active] would run too early and focus nothing — Escape
  // would then never reach trapTab.
  useEffect(() => {
    setEntered(false);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [index, active]);

  // Stable callback ref: runs when the dialog actually mounts (rect
  // resolved) and again per step (the popover is keyed by step id, so
  // it remounts). Skips if focus already sits inside the dialog so a
  // scroll re-snap can never steal focus from Next/Skip.
  const setDialog = useCallback((el: HTMLDivElement | null) => {
    dialogRef.current = el;
    if (el && !el.contains(document.activeElement)) {
      el.focus();
    }
  }, []);

  if (!step || !rect) {
    return null;
  }

  const titleId = `tour-title-${step.id}`;
  // Popover below the target when room allows, else above. Nav stops
  // (fixed bottom chrome) always land above.
  const placeAbove = rect.top + rect.height + 240 > window.innerHeight;
  const ringStyle: React.CSSProperties = {
    top: Math.max(0, rect.top - RING_PAD),
    left: Math.max(0, rect.left - RING_PAD),
    width: rect.width + RING_PAD * 2,
    height: rect.height + RING_PAD * 2,
    boxShadow: '0 0 0 9999px rgba(10, 10, 10, 0.7)',
  };
  const popoverStyle: React.CSSProperties = placeAbove
    ? {
        bottom: Math.min(
          Math.max(8, window.innerHeight - rect.top + 12),
          Math.max(8, window.innerHeight - 260),
        ),
      }
    : { top: Math.min(rect.top + rect.height + 12, Math.max(8, window.innerHeight - 260)) };

  function trapTab(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) {
      return;
    }
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      first.focus();
    }
  }

  function advance(): void {
    if (!active) {
      return;
    }
    if (index >= active.length - 1) {
      onFinish();
    } else {
      setIndex(index + 1);
    }
  }

  return (
    <div className="fixed inset-0 z-50" data-testid="product-tour">
      {/* Tap catcher: the whole screen is backdrop — any tap closes. */}
      <button
        type="button"
        aria-label="Skip tour"
        onClick={onSkip}
        className={`absolute inset-0 h-full w-full cursor-default bg-transparent transition-opacity duration-ui ease-out-strong motion-reduce:transition-none ${
          entered ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Spotlight ring: transparent middle (target undimmed), the giant
          spread shadow dims everything else. Snaps — never transitions
          position. */}
      <div
        aria-hidden="true"
        style={ringStyle}
        className="pointer-events-none absolute rounded-xl border-2 border-accent"
      />
      {/* Popover. Key on step id remounts per step so the entrance re-runs. */}
      <div
        key={step.id}
        className="pointer-events-none absolute left-0 right-0 mx-auto w-[calc(100%-2rem)] max-w-sm"
        style={popoverStyle}
      >
        <div
          ref={setDialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={trapTab}
          className={`pointer-events-auto rounded-card border border-border bg-surface p-4 shadow-card transition-[opacity,transform] duration-ui ease-out-strong motion-reduce:transition-none ${
            entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <p id={titleId} className="text-h3 font-semibold text-text">
            {step.title}
          </p>
          <p className="mt-1 text-body leading-relaxed text-muted">{step.body}</p>
          <p className="mt-3 text-small font-medium text-faint">
            {index + 1} of {total}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={advance}
              className="inline-flex min-h-touch flex-1 items-center justify-center rounded-pill bg-accent px-5 py-2 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
            >
              {last ? 'Finish' : 'Next'}
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex min-h-touch items-center justify-center px-3 py-2 text-body font-medium text-muted"
            >
              Skip tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
