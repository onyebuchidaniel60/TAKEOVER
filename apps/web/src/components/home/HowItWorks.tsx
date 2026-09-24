// "How it works" — three steps in consumer language
// (PROJECT_SPEC.md §7: no crypto jargon). Static cards; no animation.
// Phase 4b: step numbers in large display type are the visual anchor —
// no icon chips (the reference is restrained; generic icons added noise).
const STEPS = [
  {
    title: 'See what’s available',
    body: 'Browse live openings near you — tables, seats, and slots released at the last minute.',
  },
  {
    title: 'Claim your slot',
    body: 'Hold it in one tap and check out securely. Your payment is held safely until you confirm.',
  },
  {
    title: 'Enjoy, then confirm',
    body: 'The provider delivers, you confirm, and payment is released. If delivery never happens, you get your money back.',
  },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading" id="how-it-works" className="scroll-mt-20">
      <h2 id="how-it-works-heading" className="text-h2 font-bold text-text">
        How it works
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-card border border-border bg-surface p-4">
            {/*
              Static numerals never change, so no mono/tabular guard is
              needed — the display face applies. Muted, not lime: the
              numbers enumerate; lime is reserved for actions and money.
            */}
            <p aria-hidden="true" className="text-display font-bold text-muted">
              {String(index + 1).padStart(2, '0')}
            </p>
            <p className="mt-3 text-h3 font-semibold text-text">{step.title}</p>
            <p className="mt-1 text-body leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
