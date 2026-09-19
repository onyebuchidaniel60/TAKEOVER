// Completion (F4): CSRF guard for credentialed mutations. One place
// to audit — Origin allowlist validation and the required custom header live
// together in createCsrfGuard, wired once in app.ts for every /api/v1 route.
import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from '../auth/session-token';
import { AppError } from './errors';

/** Custom header the web client sends on every mutating request (see apiFetch). */
export const CSRF_CLIENT_HEADER = 'x-takeover-client';
export const CSRF_CLIENT_VALUE = 'web';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** True for the methods the guard inspects. GET/HEAD/OPTIONS are idempotent. */
export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * Rejects cross-site mutations that would otherwise ride the session cookie:
 * - skipped when the method is idempotent or no session cookie is present
 *   (no auto-attached credential means nothing to steal). This skip
 *   explicitly covers requests authenticated SOLELY via
 *   `Authorization: Bearer <session-token>` — a Bearer token is never
 *   auto-attached by the browser, and sending it cross-origin forces a
 *   CORS-preflight-gated custom header while preflight itself is already
 *   allowlist-gated, so a foreign page can neither send the header nor read
 *   the response. The CORS allowlist remains the boundary for that path.
 * - when a session cookie IS present (even alongside a Bearer token — the
 *   cookie path takes precedence), requires an allowlisted Origin
 *   (missing or unlisted → 403 FORBIDDEN_ORIGIN) and the custom client
 *   header (missing or wrong → 403 MISSING_CLIENT_HEADER). The custom header
 *   forces a CORS preflight for any cross-origin request, and preflight is
 *   already allowlist-gated, so a foreign page can neither send the header
 *   nor read the response.
 */
export function createCsrfGuard(allowlist: string[]) {
  return async function csrfGuard(request: FastifyRequest): Promise<void> {
    if (!isMutatingMethod(request.method)) {
      return;
    }
    const raw = request.cookies?.[SESSION_COOKIE_NAME];
    if (typeof raw !== 'string' || raw.length === 0) {
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0 || !allowlist.includes(origin)) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin request not allowed.');
    }
    if (request.headers[CSRF_CLIENT_HEADER] !== CSRF_CLIENT_VALUE) {
      throw new AppError(403, 'MISSING_CLIENT_HEADER', 'Missing client header.');
    }
  };
}
