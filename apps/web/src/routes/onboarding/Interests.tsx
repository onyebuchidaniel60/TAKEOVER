// Step 4 — Interests (Phase 5j). Multi-select text chips over
// SLOT_CATEGORIES (same control language as the feed's category filter;
// no new icons). Optional: Continue and Skip both persist the selection
// to sessionStorage (skipped = empty), arm the first-action banner, and
// → /sell/new. The feed consumes the stored selection once as its
// initial filter — it never persists across sessions in this phase.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import OnboardingShell, {
  ONBOARDING_PRIMARY_CTA_CLASS,
} from '../../components/onboarding/OnboardingShell';
import { saveInterests, showWelcomeBanner } from '../../lib/onboarding';
import { usePageMeta } from '../../lib/meta';
import { SLOT_CATEGORIES } from '../../lib/slots';
import { useAuth } from '../../store/auth';

export default function Interests() {
  usePageMeta({ title: 'Your interests — TAKEOVER' });
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  const [selected, setSelected] = useState<string[]>([]);

  if (!initialized) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8" aria-label="Loading">
        <LoadingSkeleton rows={2} />
      </main>
    );
  }
  if (status !== 'authenticated') {
    // The guard redirects guests to /welcome; render nothing meanwhile.
    return null;
  }

  function toggle(category: string): void {
    setSelected((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  }

  function finish(categories: string[]): void {
    saveInterests(categories);
    showWelcomeBanner();
    navigate('/sell/new');
  }

  return (
    <OnboardingShell
      step="Step 3 of 3"
      eyebrow="Your interests"
      title="What are you looking for?"
      supporting="We'll show these first on your feed."
    >
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Interest categories">
        {SLOT_CATEGORIES.map((category) => {
          const active = selected.includes(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(category)}
              className={`inline-flex min-h-touch items-center justify-center rounded-lg border px-3 py-2 text-body font-medium transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none ${
                active
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-border-strong bg-surface text-text'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => finish(selected)} className={ONBOARDING_PRIMARY_CTA_CLASS}>
        Continue
      </button>
      <button
        type="button"
        onClick={() => finish([])}
        className="min-h-touch w-full py-2 text-center text-body font-medium text-muted"
      >
        Skip
      </button>
    </OnboardingShell>
  );
}
