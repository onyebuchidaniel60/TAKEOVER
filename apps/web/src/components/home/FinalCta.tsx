// Final CTA: the closing block. One honest headline, two pill actions.
import { Link } from 'react-router-dom';

export default function FinalCta() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="rounded-card border border-border bg-surface p-6 text-center"
    >
      <h2 id="final-cta-heading" className="text-h1 font-bold text-text">
        Don&apos;t let good capacity go to waste.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-body leading-relaxed text-muted">
        Got an opening? Post it in under a minute. Looking for one? It is already on the board.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to="/sell/new"
          className="inline-flex min-h-touch items-center justify-center rounded-pill bg-accent px-5 py-2 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Create a slot
        </Link>
        <a
          href="#openings"
          className="inline-flex min-h-touch items-center justify-center rounded-pill border border-border-strong bg-transparent px-5 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Browse openings
        </a>
      </div>
    </section>
  );
}
