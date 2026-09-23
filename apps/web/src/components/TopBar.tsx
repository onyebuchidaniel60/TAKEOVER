// App header (design.md §7): one row, 56px, bg background. Brand mark +
// wordmark left (links home), wallet status right. Nothing else — the
// hamburger is gone with the drawer; the pill nav owns navigation.
// A border hairline appears only once scrolled (border color swaps, so
// the 56px height never shifts).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';
import WalletStatus from './WalletStatus';

export default function TopBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-bg transition-colors duration-ui ease-out-strong motion-reduce:transition-none ${
        scrolled ? 'border-border' : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          to="/"
          aria-label="TAKEOVER home"
          className="inline-flex min-h-touch items-center gap-2 text-h3 font-bold text-text"
        >
          <BrandMark size={24} />
          TAKEOVER
        </Link>
        <WalletStatus />
      </div>
    </header>
  );
}
