import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth';

// Debug placeholder (not final UX): shows the raw /me response.
export default function Profile() {
  const { status } = useAuth();
  const [body, setBody] = useState('Loading…');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/me', { credentials: 'include' })
      .then(async (res) => {
        const json: unknown = await res.json().catch(() => null);
        return { httpStatus: res.status, json };
      })
      .then(({ httpStatus, json }) => {
        if (!cancelled) {
          setBody(JSON.stringify({ httpStatus, body: json }, null, 2));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBody(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h2 className="text-xl font-bold">Profile (debug)</h2>
      <p className="mt-1 text-sm text-slate-500">Raw response from GET /api/v1/me.</p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 text-xs">
        {body}
      </pre>
    </main>
  );
}
