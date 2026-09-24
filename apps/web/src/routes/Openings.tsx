// Full openings list (Phase 4b): the homepage feed without the cap,
// reached via "See all openings". Same filters, same cards, paged with
// the show-more button instead of stopping at 12.
import FeedSection from '../components/FeedSection';
import { usePageMeta } from '../lib/meta';

const FULL_FEED_SIZE = 20;

export default function Openings() {
  usePageMeta({
    title: 'All openings — TAKEOVER',
    description: 'Every live opening on the board, soonest first.',
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <FeedSection pageSize={FULL_FEED_SIZE} capped={false} />
    </main>
  );
}
