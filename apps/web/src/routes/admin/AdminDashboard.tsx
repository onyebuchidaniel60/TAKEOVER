// /Admin overview tiles. Counts come from the locked admin reads:
// open reports and payment-review totals are live totals; disabled counts
// are audit-event totals (there are no re-enable endpoints, so each event
// maps to one disabled account/listing).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTile from '../../components/AdminTile';
import ErrorState from '../../components/ErrorState';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { ApiError } from '../../lib/api';
import { usePageMeta } from '../../lib/meta';
import { fetchAdminReports, fetchAuditEvents, fetchPaymentReviews } from '../../lib/admin';

export default function AdminDashboard() {
  usePageMeta({ title: 'Moderation — TAKEOVER', robots: 'noindex' });
  const [counts, setCounts] = useState<{
    openReports: number | null;
    paymentReviews: number | null;
    disabledUsers: number | null;
    disabledSlots: number | null;
  }>({ openReports: null, paymentReviews: null, disabledUsers: null, disabledSlots: null });
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void Promise.all([
      fetchAdminReports({ status: 'open', limit: 1 }),
      fetchPaymentReviews({ limit: 1 }),
      fetchAuditEvents({ eventType: 'user.disabled', limit: 1 }),
      fetchAuditEvents({ eventType: 'slot.disabled_by_admin', limit: 1 }),
    ])
      .then(([reports, reviews, users, slots]) => {
        if (cancelled) return;
        setCounts({
          openReports: reports.total,
          paymentReviews: reviews.total,
          disabledUsers: users.total,
          disabledSlots: slots.total,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-h1 font-bold text-bark dark:text-parchment">Moderation</h1>
      <p className="mt-1 text-body text-muted dark:text-drift">
        Review reports, resolve payments under review, and audit admin actions.
      </p>
      {error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => setRetryKey((k) => k + 1)} />
        </div>
      ) : counts.openReports === null ? (
        <div className="mt-4">
          <LoadingSkeleton rows={2} />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Moderation summary">
          <AdminTile label="Open reports" value={counts.openReports} to="/admin/reports" />
          <AdminTile label="Payments under review" value={counts.paymentReviews} to="/admin/payment-reviews" />
          <AdminTile label="Disabled users (audit)" value={counts.disabledUsers} to="/admin/users" />
          <AdminTile label="Disabled listings (audit)" value={counts.disabledSlots} to="/admin/slots" />
        </div>
      )}
      <nav className="mt-6 flex flex-col gap-2" aria-label="Admin sections">
        {[
          { to: '/admin/reports', label: 'Reports' },
          { to: '/admin/payment-reviews', label: 'Payment reviews' },
          { to: '/admin/users', label: 'Users' },
          { to: '/admin/slots', label: 'Listings' },
          { to: '/admin/audit', label: 'Audit trail' },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="min-h-touch rounded-xl border border-hairline bg-cream px-4 py-3 text-body font-medium text-bark shadow-sm dark:border-rootline dark:bg-cocoa dark:text-parchment dark:shadow-none"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
