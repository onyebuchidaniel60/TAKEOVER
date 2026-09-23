// TAKEOVER brand lockup (Phase 3b, D9): box outline containing the
// first letter, a horizontal line extending from the box, and the
// condensed wordmark — one cohesive lockup, not side-by-side elements.
// D11 retired the tab-in-slot mark (geometry survives in git history).
//
// Narrow-screen collapse: below 361px the full lockup swaps for the
// box+T alone (the D10 favicon principle extended to the header — the
// full lockup cannot fit 320px next to the wallet actions). Two SVGs
// with complementary breakpoints; hiding alone would keep the wide
// viewBox and its empty space.
// Type: Big Shoulders Display via the page font stack (falls back to
// sans without breaking). Color: text/muted only — no lime for lime's
// sake. Geometry is tuned at height 24 and scales proportionally.
const FAMILY = "'Big Shoulders Display', Poppins, ui-sans-serif, system-ui, sans-serif";

function BoxT() {
  return (
    <>
      <rect x="1" y="1" width="22" height="22" rx="2" fill="none" stroke="#FAFAFA" strokeWidth="1.5" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontFamily={FAMILY}
        fontSize="14"
        fontWeight={700}
        fill="#FAFAFA"
      >
        T
      </text>
    </>
  );
}

export default function BrandMark({ height = 24, className }: { height?: number; className?: string }) {
  return (
    // contents: the wrapper vanishes from layout so the SVGs participate
    // directly (the header link sizes to the visible mark, not the box).
    <span className={`contents ${className ?? ''}`} role="presentation" aria-hidden="true">
      <svg height={height} viewBox="0 0 146 24" className="hidden min-[361px]:block" aria-hidden="true" focusable="false">
        <BoxT />
        <line x1="27" y1="12" x2="37" y2="12" stroke="#A3A3A3" strokeWidth="1.5" />
        <text
          x="41"
          y="18.5"
          fontFamily={FAMILY}
          fontSize="19"
          fontWeight={600}
          letterSpacing="1"
          fill="#FAFAFA"
        >
          TAKEOVER
        </text>
      </svg>
      <svg height={height} viewBox="0 0 24 24" className="min-[361px]:hidden" aria-hidden="true" focusable="false">
        <BoxT />
      </svg>
    </span>
  );
}
