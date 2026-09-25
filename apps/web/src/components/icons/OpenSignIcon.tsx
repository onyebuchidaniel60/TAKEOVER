// Open-sign nav icon (Phase 5d): a hanging "OPEN" shop sign — the Sell
// tab is the provider's own openings view, and no lucide icon reads as
// "your open listings" (see docs/redesign/CORRECTIONS.md).
// 24×24 viewBox, currentColor, 2px stroke with round caps/joins — the same
// visual language as the lucide icons around it in the pill nav, so the
// active/inactive colors are inherited, never set here.
// Structure: nail dot → two hanger strokes → rounded sign rect → OPEN text.
// The text is fill-only (stroke would clog at this size); the silhouette
// (hook + hanging rect) carries the meaning at 24px, the letterforms read
// as texture up close.
export default function OpenSignIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="2.6" r="0.6" fill="currentColor" stroke="none" />
      <path d="M11.2 3.4 6.8 8" />
      <path d="M12.8 3.4 17.2 8" />
      <rect x="4" y="8" width="16" height="13" rx="2" />
      <text
        x="12"
        y="17.1"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="5"
        fontWeight={700}
        letterSpacing="0.4"
      >
        OPEN
      </text>
    </svg>
  );
}
