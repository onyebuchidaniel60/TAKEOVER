// Home hero: eyebrow, display headline, one supporting line, two pill
// CTAs. Compact on mobile — the feed (the primary action) must start
// above the fold. No photography (D5), no marketing superlatives.
import { Link } from 'react-router-dom';

export default function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="pt-2">
      <p className="text-small font-medium uppercase tracking-wide text-muted">Last-minute capacity</p>
      <h1 id="hero-heading" className="mt-2 text-display font-bold text-text">
        Good openings go fast.
      </h1>
      <p className="mt-2 max-w-md text-body leading-relaxed text-muted">
        TAKEOVER lists tables, seats, and appointments the moment they open up. Claim one in a
        couple of taps.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/sell/new"
          className="inline-flex min-h-touch items-center justify-center rounded-pill bg-accent px-5 py-2 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Create a slot
        </Link>
        <a
          href="#how-it-works"
          className="inline-flex min-h-touch items-center justify-center rounded-pill border border-border-strong bg-transparent px-5 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          How it works
        </a>
      </div>
    </section>
  );
}
