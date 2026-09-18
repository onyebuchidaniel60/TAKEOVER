// Phase 14k-1: "How it works" — three steps in consumer language
// (PROJECT_SPEC.md §7: no crypto jargon). Static cards; no animation.
import { BadgeCheck, Eye, Hand } from 'lucide-react';

const STEPS = [
  {
    icon: Eye,
    title: 'See what’s available',
    body: 'Browse live openings near you — tables, seats, and slots released at the last minute.',
  },
  {
    icon: Hand,
    title: 'Claim your slot',
    body: 'Hold it in one tap and check out securely. Your payment is held safely until you confirm.',
  },
  {
    icon: BadgeCheck,
    title: 'Enjoy, then confirm',
    body: 'The provider delivers, you confirm, and payment is released. If delivery never happens, you get your money back.',
  },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-heading">
      <h2 id="how-it-works-heading" className="text-xl font-bold tracking-[-0.02em]">
        How it works
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-2xl border border-stone-200 bg-white p-4 shadow-card"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-sm font-bold tabular-nums text-white"
              >
                {index + 1}
              </span>
              <step.icon size={18} aria-hidden="true" className="text-slate-700" />
            </div>
            <p className="mt-3 text-base font-semibold tracking-[-0.01em]">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
