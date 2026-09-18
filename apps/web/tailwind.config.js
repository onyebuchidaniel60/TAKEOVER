/** @type {import('tailwindcss').Config} */
export default {
  // Phase 14l-3: class-driven dark mode (warm dark, stone-based — never an
  // inversion). Components carry light + dark values on the SAME utilities
  // (e.g. bg-white dark:bg-stone-900) — not a parallel token system.
  darkMode: 'class',
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
      // Phase 14l-3 type scale (direction A + apple skill §15: tracking
      // is size-specific — negative on display/headings, neutral on body,
      // slightly positive on small; leading runs inversely to size;
      // hierarchy comes from weight + size + leading as a set).
      // Weight defaults (kept explicit at each call site): display/h1/h2
      // bold, h3 semibold, body regular, small medium. Mono is a family
      // pairing (Geist Mono + tabular numerals for every price, countdown,
      // count, and date figure) and composes with the sizes above.
      fontFamily: {
        // Geist Sans (self-hosted woff2, font-display: swap) with the
        // system stack as the instant fallback and the metric-compatible
        // tail behind it — no layout shift beyond the swap itself.
        sans: [
          'Geist Sans',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        // Geist Mono for figures. Same self-hosted treatment as sans.
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Hero price / admin stat. 30px, tightest tracking.
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        // Page titles. 24px.
        h1: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        // Section headings. 20px.
        h2: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        // Card titles. 16px.
        h3: ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        // Default body copy. 14px.
        body: ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0em' }],
        // Captions, labels, badges, counts. 12px, opened up a touch.
        small: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
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
// Type scale (14l-3, locked): display 30/36/-0.02 bold; h1 24/32/-0.02
// bold; h2 20/28/-0.01 bold; h3 16/24/-0.01 semibold; body 14/20/0
// regular; small 12/16/+0.01 medium. No text size outside this scale —
// a surface needing another size takes the nearest match. Figures
// (prices, countdowns, counts, dates) pair a scale size with font-mono
// + tabular-nums. Uppercase micro-labels may add tracking-wide on top
// of small; relaxed body copy may add leading-relaxed on top of body.
//
// Dark palette (14l-3, warm dark — stone, never an inversion):
// page stone-950, cards stone-900, inner panels stone-800; borders
// stone-800 (cards) / stone-700→600 (inputs/buttons); text stone-100 /
// stone-300 / stone-400; primary fills invert to stone-100 with
// stone-900 text; status hues step to the 300 level on 950 washes
// (emerald/amber/orange/sky/red); destructive fills stay red-700+ for
// white-text contrast. Elevation in dark comes from border contrast,
// not shadows (shadow-card/shadow-sm render dark:shadow-none).
// Every pair below is contrast-measured (see the phase report).
