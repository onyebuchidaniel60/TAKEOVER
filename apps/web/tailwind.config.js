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
    },
  },
  plugins: [],
};

// Palette (stock Tailwind, unchanged): slate for text/surfaces/borders,
// emerald for available/paid, amber for pending/review, red for destructive
// and errors, orange for low-stock urgency. Status is always text + color,
// never color alone.
//
// Type scale (stock Tailwind sizes, used consistently):
// h1 page titles text-2xl font-bold tracking-tight; card titles text-base
// font-semibold; body text-sm; captions/labels text-xs. Prices use
// text-2xl (large) / text-base via PriceDisplay.
