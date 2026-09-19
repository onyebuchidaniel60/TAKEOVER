/** @type {import('tailwindcss').Config} */
export default {
  // Class-driven dark mode (warm dark, stone-based — never an
  // inversion). Components carry light + dark values on the SAME utilities
  // (e.g. bg-white dark:bg-stone-900) — not a parallel token system.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // design tokens. Values match what the UI already used —
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
      // 1 Motion tokens (emil-design-eng: strong custom curves,
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
      // 1 Shadow scale (direction A: warm, semi-transparent —
      // never solid borders for elevation). shadow-sm stays for dense
      // rows; card/card-hover carry the feed.
      boxShadow: {
        card: '0 1px 2px rgb(28 25 23 / 0.06), 0 8px 24px -12px rgb(28 25 23 / 0.18)',
        'card-hover':
          '0 2px 4px rgb(28 25 23 / 0.06), 0 16px 32px -12px rgb(28 25 23 / 0.22)',
      },
      // 3 Type scale (direction A + apple skill §15: tracking
      // is size-specific — negative on display/headings, neutral on body,
      // slightly positive on small; leading runs inversely to size;
      // hierarchy comes from weight + size + leading as a set).
      // Weight defaults (kept explicit at each call site): display/h1/h2
      // bold, h3 semibold, body regular, small medium. Mono is a family
      // pairing (Geist Mono + tabular numerals for every price, countdown,
      // count, and date figure) and composes with the sizes above.
      fontFamily: {
        // Retheme: system stacks (owner call — the bundled webfont is
        // gone). The metric fallback chain keeps rendering quiet on
        // every platform.
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        // System mono for figures (prices, countdowns, counts, dates).
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
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
      // Retheme: warm earthy palette (owner call). No pure white, no pure
      // black, no cool grays (slate/gray/zinc/neutral are banned — grep
      // enforces it). Every text pair below measures ≥ 4.5:1 and every
      // interactive boundary ≥ 3:1 in BOTH modes (see the retheme report);
      // container/hairline borders stay decorative, as in the baseline.
      colors: {
        // Light surfaces: ivory page, cream cards, sand inset panels/chips.
        ivory: '#FAF6EC',
        cream: '#F4EDDD',
        sand: '#E8DCC3',
        // Light borders: hairline (decorative card edges), clayline +
        // ochreline (decorative tinted edges), borderwarm (interactive
        // input/button edges, 3.07:1 on cream).
        hairline: '#D8C8A8',
        clayline: '#D8A88F',
        ochreline: '#C9A94E',
        borderwarm: '#9C845A',
        // Light text: bark primary, taupe secondary, muted tertiary,
        // faint icons/placeholders only (3.45:1, never body copy).
        bark: '#453727',
        taupe: '#5F4F3B',
        muted: '#6F5E4A',
        faint: '#8E7C64',
        // Terracotta: primary fills + badge (ivory text 4.94:1),
        // links (terradeep 5.83:1 on cream), focus rings.
        terra: '#9D5A30',
        terradeep: '#8A4A24',
        // Softened status hues: sage success, ochre warning, clay danger.
        sage: '#556B4C',
        sagewash: '#E3E8D8',
        ochre: '#77601C',
        ochrewash: '#EEE3C0',
        clay: '#98452C',
        claywash: '#F1DCD0',
        // Destructive fills (ivory text 7.73:1 on claydeep).
        claydeep: '#7E3A24',
        // Warm dark: coal page, cocoa cards, umber inset panels.
        coal: '#1D130C',
        cocoa: '#2B1E12',
        umber: '#3B2B1A',
        // Dark text: parchment primary, khaki secondary, drift muted.
        parchment: '#F1E7D2',
        khaki: '#CFBE9F',
        drift: '#AE9C7E',
        // Dark borders: rootline decorative, rootedge interactive (3.38:1).
        rootline: '#4E3A24',
        rootedge: '#83704B',
        // Dark accents: sandlight primary fills (coal text 13.17:1),
        // terralight links/rings, clayfilld destructive fills
        // (ivory text 4.71:1, cocoa boundary 3.18:1).
        sandlight: '#EAD9BC',
        terralight: '#D2906A',
        saged: '#A9BE9C',
        sagewashd: '#22301F',
        ochred: '#D3B95C',
        ochrewashd: '#2C2410',
        clayd: '#D8957A',
        claywashd: '#332016',
        clayfilld: '#A65A32',
      },
      // 1 Feed entrance (direction A only, capped + staggered in
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

// Palette (retheme — warm earthy, owner call; supersedes the direction A
// slate/stone system): bark ink text on ivory pages and cream cards;
// sand inset panels/chips; hairline card edges; status hues softened to
// sage (success), ochre (warning), clay (danger). Status is always text
// + color, never color alone. Cool grays are banned (slate/gray/zinc/
// neutral must not appear in src). Dark mode is warm deep brown.
//
// Radius language (direction A, locked): cards rounded-2xl, inner
// panels/buttons/inputs rounded-lg, badges/pills rounded-full. Modals join
// rounded-2xl; nothing new uses rounded-xl-for-cards.
//
// Type scale (locked; proportions unchanged by the retheme):
// display 30/36/-0.02 bold; h1 24/32/-0.02 bold; h2 20/28/-0.01 bold;
// h3 16/24/-0.01 semibold; body 14/20/0 regular; small 12/16/+0.01
// medium. System stacks only (Geist removed by owner call). Figures
// pair a scale size with font-mono + tabular-nums.
//
// Earthy palette (retheme, warm organic calm): ivory pages, cream
// cards, sand insets, taupe/brown text, terracotta actions/links/
// rings, sage/ochre/clay status hues. Dark mode is warm deep brown
// (coal/cocoa/umber), never cool gray. Full hex table + measured
// pairs live in the retheme report.
