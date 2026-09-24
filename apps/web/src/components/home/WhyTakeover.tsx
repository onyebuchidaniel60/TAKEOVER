// Why TAKEOVER: problem → solution in one section. Two short
// paragraphs, stacked on mobile, two columns on tablet+. The visual is
// pure CSS (stacked mini-cards) — no icon budget spent, no photography.
//
// Phase 4b: the three marks are anchor buttons to the sections they
// abstract (problem → How it works, solution → Features, questions →
// FAQ) instead of decoration. Plain hash anchors reuse the existing
// smooth-scroll behavior (CSS, reduced-motion guarded); each keeps a
// 44px hit area around the unchanged 32px mark.
const JUMPS = [
  { href: '#how-it-works', label: 'Jump to How it works', bar: 'bg-surface-2' },
  { href: '#features', label: 'Jump to Features', bar: 'bg-accent' },
  { href: '#faq', label: 'Jump to FAQ', bar: 'bg-surface-2' },
] as const;

export default function WhyTakeover() {
  return (
    <section aria-labelledby="why-heading">
      <h2 id="why-heading" className="text-h2 font-bold text-text">
        Why TAKEOVER
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-h3 font-semibold text-text">The problem</p>
          <p className="mt-1 text-body leading-relaxed text-muted">
            Evenings sell out while good tables sit empty. Cancellations happen every day, but
            there is no fast way to pass them on — so providers eat the loss and buyers never
            hear about the opening.
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-h3 font-semibold text-text">The solution</p>
          <p className="mt-1 text-body leading-relaxed text-muted">
            TAKEOVER is the shared board for released capacity. Providers post an opening in
            under a minute; buyers claim it on the spot. Payment is held safely until delivery
            is confirmed.
          </p>
          <div className="mt-1 flex items-center gap-1">
            {JUMPS.map((jump) => (
              <a
                key={jump.href}
                href={jump.href}
                aria-label={jump.label}
                className="flex min-h-touch items-center justify-center rounded-chip px-1 transition-transform duration-press ease-out-strong hover:scale-105 active:scale-[0.97] motion-reduce:transition-none"
              >
                <span aria-hidden="true" className={`h-8 w-14 rounded-chip ${jump.bar}`} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
