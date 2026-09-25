// Reusable avatar (Phase 5d). Renders the profile picture when set,
// else the initial-circle fallback (the Phase 4 pattern). Decorative:
// the name always renders as adjacent text, so the image is hidden from
// assistive tech in both states.
export default function Avatar({
  data,
  name,
  size,
}: {
  /** Avatar data URI, null/undefined when the user set none. */
  data: string | null | undefined;
  /** Display name (fallback initial source). */
  name: string;
  /** Diameter in px. */
  size: number;
}) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  if (data) {
    return (
      <img
        src={data}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-body font-semibold text-muted"
    >
      {initial}
    </span>
  );
}
