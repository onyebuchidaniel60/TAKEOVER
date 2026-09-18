/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Phase 11 design tokens. Values match what the UI already used —
      // this is naming and consolidating, not a visual change.
      minHeight: {
        // Minimum touch target (44×44 CSS px). Replaces min-h-[44px].
        touch: '44px',
        // Tall form fields (description textarea). Replaces min-h-[88px].
        area: '88px',
      },
      minWidth: {
        // Admin data tables scroll horizontally inside their card below
        // this width instead of squeezing columns or the page.
        admintable: '40rem',
      },
      // Phase 14i-1 motion tokens (emil-design-eng: strong custom curves,
      // never bare ease/ease-in; every UI duration under 300ms).
      transitionTimingFunction: {
        // Strong ease-out — entrances and standard UI. Starts fast so the
        // interface feels responsive at the moment the user watches.
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
        // Strong ease-in-out — on-screen movement (never entrances).
        'in-out-strong': 'cubic-bezier(0.77, 0, 0.175, 1)',
        // iOS-like drawer curve — sheets/drawers if a future phase adds them.
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        // Button press feedback (100-160ms budget).
        press: '120ms',
        // Standard UI: hovers, card entrances, small popovers.
        ui: '200ms',
        // Larger panels/dialogs (200-500ms budget, kept at the floor).
        panel: '280ms',
      },
      // Phase 14i-1 shadow scale (direction A: warm, semi-transparent —
      // never solid borders for elevation). shadow-sm stays for dense
      // rows; card/card-hover carry the feed.
      boxShadow: {
        card: '0 1px 2px rgb(28 25 23 / 0.06), 0 8px 24px -12px rgb(28 25 23 / 0.18)',
        'card-hover':
          '0 2px 4px rgb(28 25 23 / 0.06), 0 16px 32px -12px rgb(28 25 23 / 0.22)',
      },
      // Phase 14i-1 feed entrance (direction A only, capped + staggered in
      // SlotList). opacity + translateY(8px) only — never scale(0).
      keyframes: {
        'feed-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'feed-in': 'feed-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both',
      },
    },
  },
  plugins: [],
};

// Palette (direction A "Warm marketplace", 14i-1): slate-900 ink text is
// unchanged (contrast-safe everywhere); page surfaces move slate-50 →
// stone-100 and card borders slate-200 → stone-200 for warmth. Status hues
// are unchanged (emerald available/paid, amber pending/review, orange
// low-stock urgency). Status is always text + color, never color alone.
// Red scale, unified 14i-1: text red-800, fills bg-red-900, borders
// red-200, washes bg-red-50. (text-red-600/red-700 stragglers outside the
// feed + chrome scope move in 14i-2/14i-3.)
//
// Radius language (direction A, locked 14i-1): cards rounded-2xl, inner
// panels/buttons/inputs rounded-lg, badges/pills rounded-full. Modals join
// rounded-2xl in 14i-3; nothing new uses rounded-xl-for-cards.
//
// Type scale (stock Tailwind sizes, used consistently):
// h1 page titles text-2xl font-bold tracking-tight; card titles text-base
// font-semibold; body text-sm; captions/labels text-xs. Prices use
// text-2xl (large) / text-base via PriceDisplay. System stack only (no
// webfont): tracking is size-specific (tight titles, neutral body) and
// every time/money/count figure sets tabular-nums.
