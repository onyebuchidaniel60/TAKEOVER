// Step 1 — Welcome (Phase 5j). Full-viewport centered brand lockup,
// Phase 3b headline, consumer supporting line (SPEC §7: no "escrow", no
// chain language). Primary → /onboarding/account; secondary → /login.
// Rendered outside the app chrome (no TopBar, no pill nav).
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { usePageMeta } from '../lib/meta';

export default function Welcome() {
  usePageMeta({
    title: 'Welcome — TAKEOVER',
    description: 'TAKEOVER is the last-minute marketplace for released capacity.',
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8 text-center">
      <div aria-hidden="true">
        <BrandMark height={32} />
      </div>
      <p className="mt-8 text-small font-medium uppercase tracking-wide text-muted">
        Welcome to TAKEOVER
      </p>
      <h1 className="mt-2 text-display font-bold text-text">Good openings go fast.</h1>
      <p className="mt-2 max-w-md text-body leading-relaxed text-muted">
        TAKEOVER lists tables, seats, and appointments the moment they open up. Claim one in a
        couple of taps.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2">
        <Link
          to="/onboarding/account"
          className="inline-flex min-h-touch w-full items-center justify-center rounded-pill bg-accent px-5 py-2 text-body font-semibold text-accent-ink transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Get started
        </Link>
        <p className="mt-2 text-center text-body text-muted">Already have an account?</p>
        <Link
          to="/login"
          className="inline-flex min-h-touch w-full items-center justify-center rounded-pill border border-border-strong bg-transparent px-5 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
