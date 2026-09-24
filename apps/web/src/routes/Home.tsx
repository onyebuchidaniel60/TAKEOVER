// Marketplace home: hero, capped feed, and the supporting sections.
// The feed itself lives in FeedSection (shared with /openings).
import Contact from '../components/home/Contact';
import Faq from '../components/home/Faq';
import Features from '../components/home/Features';
import FinalCta from '../components/home/FinalCta';
import Footer from '../components/home/Footer';
import Hero from '../components/home/Hero';
import HowItWorks from '../components/home/HowItWorks';
import Reveal from '../components/home/Reveal';
import FeedSection from '../components/FeedSection';
import WhyTakeover from '../components/home/WhyTakeover';
import { usePageMeta } from '../lib/meta';

// Homepage feed cap (Phase 4b): the overview stays short; anything
// beyond the cap lives behind "See all openings" → /openings.
const HOME_FEED_SIZE = 12;

export default function Home() {
  usePageMeta({
    title: 'TAKEOVER — last-minute availability, claimed',
    description:
      'TAKEOVER is the last-minute marketplace for released capacity. Claim an opening before it’s gone.',
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Hero />
      <FeedSection pageSize={HOME_FEED_SIZE} capped />
      <div className="mt-12 flex flex-col gap-10">
        <Reveal>
          <HowItWorks />
        </Reveal>
        <Reveal>
          <WhyTakeover />
        </Reveal>
        <Reveal>
          <Features />
        </Reveal>
        <Reveal>
          <FinalCta />
        </Reveal>
        <Reveal>
          <Faq />
        </Reveal>
        <Reveal>
          <Contact />
        </Reveal>
        <Footer />
      </div>
    </main>
  );
}
