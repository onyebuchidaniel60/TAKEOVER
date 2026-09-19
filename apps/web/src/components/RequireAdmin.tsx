// Admin-only route guard. Authenticated AND role='admin' passes.
// Guests fall back to the marketplace (preserving the return target like
// RequireAuth); signed-in non-admins go to "/" with a notice instead.
import { Navigate, useLocation } from 'react-router-dom';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { isAdminUser } from '../lib/admin';
import { useAuth } from '../store/auth';

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!initialized) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <LoadingSkeleton rows={2} />
      </main>
    );
  }
  if (status !== 'authenticated') {
    return (
      <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
    );
  }
  if (!isAdminUser(user)) {
    return <Navigate to="/" replace state={{ notice: 'Admin access required.' }} />;
  }
  return <>{children}</>;
}
