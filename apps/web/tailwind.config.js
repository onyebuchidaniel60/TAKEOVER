/** @type {import('tailwindcss').Config} */
export default {
  // Dark-only (D1). No darkMode switch: there is no light mode and no
  // theme toggle, so no `dark:` variant is ever generated. Every surface
  // below IS the dark value.
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // design tokens from design.md §3 (visual language) and §4
      // (motion). Semantic names only: components reference intent
      // (bg, surface, accent), never a hue.
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
      // Motion tokens (design.md §4: strong custom curves, never bare
      // ease/ease-in; every UI duration under 300ms).
      transitionTimingFunction: {
        // Strong ease-out — entrances and standard UI. Starts fast so the
        // interface feels responsive at the moment the user watches.
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
        // Spec ease-in-out — exits, modals (design.md §4). Overrides
        // Tailwind's default ease-in-out with the spec curve. Unused by
        // components today; Phase 9 (dialogs) wires it.
        'in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
        // iOS-like drawer curve — sheets/drawers (the pill nav in Phase 2).
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
      // Shadows: depth reads through surface value shifts, not shadows
      // (design.md §3.2). These two survive only for floating overlays
      // (modals, drawers, the nav pill) — one soft dark wide low-opacity
      // shadow to separate overlay from page.
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.55)',
        'card-hover':
          '0 2px 4px rgb(0 0 0 / 0.4), 0 16px 32px -12px rgb(0 0 0 / 0.6)',
      },
      // Type scale (design.md §3.3). Self-hosted Poppins (body) + Big
      // Shoulders Display (display steps) with system fallbacks — no
      // runtime CDN. Weight stays explicit at each call site
      // (display/h1/h2 bold, h3 semibold, body regular, small medium).
      // Mono stays the system stack: figures pair a scale size with
      // font-mono + tabular-nums (prices, countdowns, counts, dates).
      // display/h1/h2 resolve to the display face via index.css
      // (.text-* + :not(.font-mono) guard, so money surfaces keep mono).
      // Line heights are unitless spec values: 1.2 display/h1, 1.3
      // h2/h3, 1.5 body/small.
      fontFamily: {
        sans: [
          'Poppins',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        display: [
          '"Big Shoulders Display"',
          'Poppins',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Hero price / end-cards. 30px, tightest tracking.
        display: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        // Page titles. 24px.
        h1: ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        // Section headings. 20px.
        h2: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        // Card titles. 16px.
        h3: ['1rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        // Default body copy. 14px.
        body: ['0.875rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        // Captions, labels, badges, counts. 12px, opened up a touch.
        small: ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.01em' }],
      },
      // Palette (design.md §3.1): near-black base, one electric-lime
      // accent, disciplined neutral ramp. Lime is a highlight on ≤10%
      // of any screen. No pure black/white, no second hue — danger and
      // warning are functional, not decorative. Every text pair below
      // measures ≥ 4.5:1, every UI boundary ≥ 3:1 (audit-verified).
      colors: {
        bg: '#0A0A0A',
        surface: '#141414',
        'surface-2': '#1C1C1C',
        border: '#262626',
        'border-strong': '#333333',
        text: '#FAFAFA',
        'text-muted': '#A3A3A3',
        'text-faint': '#6B6B6B',
        accent: '#C4F135',
        'accent-hover': '#B5E52C',
        'accent-ink': '#0A0A0A',
        danger: '#F87171',
        warning: '#FBBF24',
      },
      // Radii (design.md §3.5) — mapped to element class. Adopted
      // per-surface in each redesign phase (Phase 2+); components keep
      // their current rounding until their phase.
      borderRadius: {
        card: '24px',
        control: '16px',
        chip: '12px',
        pill: '9999px',
      },
      // Feed entrance. opacity + translateY(8px) only — never scale(0).
      // Stagger (40ms, capped at 8) lives in SlotList.
      keyframes: {
        'feed-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // In-flight pulse for transitional escrow states (design.md §4
        // exception: 1.2s opacity cycle). Always paired with
        // motion-safe: so prefers-reduced-motion renders the dot static
        // (the global blanket alone would freeze it mid-fade).
        'pulse-soft': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'feed-in': 'feed-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'pulse-soft': 'pulse-soft 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

// Token doctrine (design.md is the source of truth; this comment is an
// index, not a second source):
//
// Palette: bg page, surface cards, surface-2 insets/inputs/chips,
// border hairlines, border-strong focus/active, text primary,
// text-muted secondary, text-faint tertiary, accent lime CTAs/active,
// accent-hover pressed lime, accent-ink on-lime ink, danger errors,
// warning in-review. Status is always text + color, never color alone.
//
// Radii: card 24px (cards, panels, modals, nav pill), control 16px
// (buttons non-pill, inputs, large chips), chip 12px (tags, badges),
// pill 9999px (primary CTAs, nav, active indicators). Primary buttons
// are pills; cards are 24px, never pills; inputs are 16px.
//
// Type: display 30/1.2/-0.02 bold; h1 24/1.2/-0.02 bold;
// h2 20/1.3/-0.01 bold; h3 16/1.3/-0.01 semibold; body 14/1.5/0
// regular; small 12/1.5/+0.01 medium. System stacks only. Figures pair
// a scale size with font-mono + tabular-nums.
//
// Motion: press 120ms, ui 200ms, panel 280ms; out-strong entrances,
// in-out exits/modals, drawer sheets. All motion under 300ms;
// prefers-reduced-motion collapses it (index.css).
//
// Spacing: Tailwind's default 4px-based scale; no custom override.
// Screen gutters 16px mobile / 24px tablet+; rhythm 16/24/32px.
