// Minimal app footer: small lockup, one Nimiq Pay line, section links,
// license line. No logo walls, no fabricated proof.
import BrandMark from '../BrandMark';

export default function Footer() {
  return (
    <footer className="border-t border-border pt-6" aria-label="Footer">
      <BrandMark height={20} />
      <p className="mt-3 text-body text-muted">Built for Nimiq Pay.</p>
      <nav aria-label="Footer" className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
        {[
          ['How it works', '#how-it-works'],
          ['FAQ', '#faq'],
          ['Contact', '#contact'],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-touch items-center px-2 text-body font-medium text-muted"
          >
            {label}
          </a>
        ))}
      </nav>
      <p className="mt-4 text-small text-faint">MIT licensed.</p>
    </footer>
  );
}
