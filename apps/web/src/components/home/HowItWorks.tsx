// "How it works" — three steps in consumer language
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
      <h2 id="how-it-works-heading" className="text-h2 font-bold text-bark dark:text-parchment">
        How it works
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-2xl border border-hairline bg-cream p-4 shadow-card dark:border-rootline dark:bg-cocoa dark:shadow-none"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-terra font-mono text-small font-bold tabular-nums text-ivory dark:bg-sandlight dark:text-coal"
              >
                {index + 1}
              </span>
              <step.icon size={18} aria-hidden="true" className="text-taupe dark:text-khaki" />
            </div>
            <p className="mt-3 text-h3 font-semibold text-bark dark:text-parchment">{step.title}</p>
            <p className="mt-1 text-body leading-relaxed text-taupe dark:text-drift">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
