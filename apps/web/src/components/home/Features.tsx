// Features: four compact panels, reused icons only (zero new icons).
// Plain-language claims, each verifiable in the app today — no
// fabricated proof, no metrics, no logo walls.
import { Bell, Hand, Search, Tag } from 'lucide-react';

const FEATURES = [
  {
    icon: Search,
    title: 'Instant discovery',
    body: 'Live openings near you, sorted soonest first.',
  },
  {
    icon: Hand,
    title: 'Held safely',
    body: 'Your payment is held until delivery is confirmed.',
  },
  {
    icon: Tag,
    title: 'Fair listings',
    body: 'Providers pay a small NIM fee per listing, so the board stays free of spam.',
  },
  {
    icon: Bell,
    title: 'Stay posted',
    body: 'Know the moment your claim is funded or delivered.',
  },
];

export default function Features() {
  return (
    <section aria-labelledby="features-heading">
      <h2 id="features-heading" className="text-h2 font-bold text-text">
        Built for the last minute
      </h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="rounded-card border border-border bg-surface p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
              <feature.icon size={20} aria-hidden="true" />
            </span>
            <p className="mt-3 text-h3 font-semibold text-text">{feature.title}</p>
            <p className="mt-1 text-body leading-relaxed text-muted">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
