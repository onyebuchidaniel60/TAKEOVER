import { Navigate, useLocation } from 'react-router-dom';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { useAuth } from '../store/auth';

// Auth-guarded routes wait for the first session check, then send guests to
// the marketplace while preserving where they were headed: after login the
// app navigates back to `state.from` (see ReturnToHandler in App.tsx).
// Only same-origin relative paths are ever honored as return targets.

/** Extract a safe return-to path from router state, or null. Pure (unit-tested). */
export function getReturnTo(state: unknown, currentPath: string): string | null {
  if (!state || typeof state !== 'object' || !('from' in state)) {
    return null;
  }
  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'string') {
    return null;
  }
  if (!from.startsWith('/') || from.startsWith('//') || from === currentPath) {
    return null;
  }
  return from;
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
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
      <Navigate
        to="/"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}
