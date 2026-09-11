// Phase 11: catch-all 404 page for unknown paths. Consumer language, with a
// way back to the marketplace.
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import { usePageMeta } from '../lib/meta';

export default function NotFound() {
  usePageMeta({ title: 'Not found — TAKEOVER' });
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <EmptyState
        title="This page doesn’t exist"
        body="The link may be wrong or the page moved. Start back at what’s available now."
        action={
          <Link
            to="/"
            className="inline-block min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            See available openings
          </Link>
        }
      />
    </main>
  );
}
