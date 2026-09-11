# takeover-web — auth config (dev vs prod)

Auth uses an `HttpOnly` session cookie (`takeover_session`), never a bearer
token. All authenticated fetches go through `src/lib/api.ts` (`apiFetch`),
which always sends `credentials: 'include'`.

- Dev: Vite (`vite.config.ts`) proxies same-origin `/api` to
  `http://localhost:3001`, so cookies stay first-party. Backend sets
  `SameSite=Lax, Secure=false` when `NODE_ENV !== 'production'`.
- Prod (locked topology: Vercel frontend → Railway backend, cross-origin):
  the frontend calls the Railway API URL directly with
  `credentials: 'include'`. Backend sets `SameSite=None, Secure=true` when
  `NODE_ENV=production` and only answers CORS to origins in the backend
  `CORS_ORIGINS` allowlist (with `credentials: true`, no wildcard).

No bearer-token fallback exists in this phase.
