import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { sessions, users } from '../../../../db/schema';
import { AppError } from '../http/errors';
import { parseBearerToken, parseSessionToken, SESSION_COOKIE_NAME, sessionHashMatches } from './session-token';

export interface AuthUser {
  sessionId: string;
  id: string;
  walletAddress: string;
  role: 'buyer' | 'provider' | 'admin';
  status: 'active' | 'disabled';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    /** Set when the session is otherwise valid but the user is disabled. */
    accountDisabled?: boolean;
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieOptions(): {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'none';
} {
  // Locked deployment topology: Vercel frontend -> Railway backend (cross-origin).
  // Dev (NODE_ENV !== 'production'): SameSite=Lax, Secure=false so local HTTP
  // (Vite proxy, first-party) keeps working.
  // Production: SameSite=None, Secure=true so the browser sends the session
  // cookie on cross-site HTTPS requests with credentials:'include'.
  // HttpOnly is always true.
  if (isProduction()) {
    return { path: '/', httpOnly: true, secure: true, sameSite: 'none' };
  }
  return { path: '/', httpOnly: true, secure: false, sameSite: 'lax' };
}

/**
 * Resolves the session into req.user from the takeover_session cookie
 * (preferred) or — Bearer fallback for cookie-blocking WebViews —
 * from `Authorization: Bearer <sessionId>.<secret>`. Never throws for
 * missing/invalid sessions — it just leaves req.user undefined. Both
 * presentations resolve to the SAME session row with the SAME constant-time
 * secret comparison, TTL, revocation, and disabled-user handling below.
 * A session whose user is disabled sets req.accountDisabled (belt-and-suspenders with
 * the revoked-sessions delete on disable): requireAuth maps that to
 * 401 ACCOUNT_DISABLED so a disabled user is told why, instead of a bare
 * unauthenticated. Disabled status remains admin-only data elsewhere.
 */
export async function sessionMiddleware(request: FastifyRequest): Promise<void> {
  request.user = undefined;
  request.accountDisabled = false;
  const rawCookie = request.cookies?.[SESSION_COOKIE_NAME];
  const fromCookie = parseSessionToken(rawCookie);
  // Cookie wins when it parses; Bearer is the fallback for hosts that drop
  // the cookie (Nimiq Pay Android WebView third-party-cookie policy).
  const parsed = fromCookie ?? parseBearerToken(request.headers.authorization);
  if (!parsed) {
    return;
  }
  const db = getDb();
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, parsed.sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) {
    return;
  }
  if (!sessionHashMatches(session.tokenHash, parsed.secret)) {
    return;
  }
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (!user) {
    return;
  }
  // Disabled check comes before revoked/expiry: a disabled user hears
  // ACCOUNT_DISABLED even when their session row was already revoked (the
  // disable path revokes sessions AND this flag covers any surviving row).
  if (user.status !== 'active' || user.disabledAt !== null) {
    request.accountDisabled = true;
    return;
  }
  if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
    return;
  }
  request.user = {
    sessionId: session.id,
    id: user.id,
    walletAddress: user.walletAddress,
    role: user.role,
    status: user.status,
  };
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));
}

export async function requireAuth(request: FastifyRequest): Promise<AuthUser> {
  if (!request.user) {
    if (request.accountDisabled === true) {
      throw new AppError(401, 'ACCOUNT_DISABLED', 'This account is disabled.');
    }
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  return request.user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}
