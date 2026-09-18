// Phase 14k-1: TAKEOVER brand mark — a claim tab landing in a release slot.
//
// Concept (chosen from three sketches; see the phase report): a rounded
// "U" cradle (the released slot on the board) with a solid tab dropping
// into its mouth (the claim landing). One metaphor, mirror-symmetric about
// x=16, all fills (no strokes to mismatch), one corner radius (rx=3) on
// every path. Bold rectilinear shapes hold at 16px: arms/tab render 3px
// wide with 1px gutters, and the union stays a distinct silhouette in
// monochrome. Single color via currentColor; favicon/bg variants compose
// their own fills in public/favicon.svg instead.
export default function BrandMark({
  size = 24,
  className,
  title = 'TAKEOVER',
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <rect x="5" y="12" width="6" height="16" rx="3" />
      <rect x="21" y="12" width="6" height="16" rx="3" />
      <rect x="5" y="22" width="22" height="6" rx="3" />
      <rect x="13" y="4" width="6" height="14" rx="3" />
    </svg>
  );
}
