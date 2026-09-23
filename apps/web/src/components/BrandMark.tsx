// TAKEOVER brand mark — a claim tab landing in a release slot.
//
// Concept (chosen from three sketches; see the phase report): a rounded
// "U" cradle (the released slot on the board) with a solid tab dropping
// into its mouth (the claim landing). One metaphor, mirror-symmetric about
// x=16, one corner radius (rx=3) on every mark path. Bold rectilinear
// shapes hold at 16px: arms/tab render 3px wide with 1px gutters, and the
// union stays a distinct silhouette in monochrome.
//
// D6 color treatment (geometry unchanged): dark tile (bg) with a hairline
// edge so the tile reads on the bg page, light cradle (text), lime tab
// (accent). The standalone assets in public/ carry the same treatment.
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
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <rect width="32" height="32" rx="7" fill="#0A0A0A" stroke="#262626" strokeWidth="1" />
      <g fill="#FAFAFA">
        <rect x="5" y="12" width="6" height="16" rx="3" />
        <rect x="21" y="12" width="6" height="16" rx="3" />
        <rect x="5" y="22" width="22" height="6" rx="3" />
      </g>
      <rect x="13" y="4" width="6" height="14" rx="3" fill="#C4F135" />
    </svg>
  );
}
