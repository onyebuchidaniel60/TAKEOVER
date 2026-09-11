import { Navigate } from 'react-router-dom';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { useAuth } from '../store/auth';

// Auth-guarded routes wait for the first session check, then send guests home.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  if (!initialized) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <LoadingSkeleton rows={2} />
      </main>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
