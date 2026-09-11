import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { sessions, users } from '../../../../db/schema';
import { AppError } from '../http/errors';
import { parseSessionToken, SESSION_COOKIE_NAME, sessionHashMatches } from './session-token';

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
  // HttpOnly is always true. No bearer-token fallback (per Phase 3 completion).
  if (isProduction()) {
    return { path: '/', httpOnly: true, secure: true, sameSite: 'none' };
  }
  return { path: '/', httpOnly: true, secure: false, sameSite: 'lax' };
}

/**
 * Resolves the takeover_session cookie into req.user. Never throws for
 * missing/invalid sessions — it just leaves req.user undefined. Disabled users
 * are treated as unauthenticated (their disabled status is admin-only data).
 */
export async function sessionMiddleware(request: FastifyRequest): Promise<void> {
  request.user = undefined;
  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  const parsed = parseSessionToken(raw);
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
  if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
    return;
  }
  if (!sessionHashMatches(session.tokenHash, parsed.secret)) {
    return;
  }
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (!user || user.status !== 'active' || user.disabledAt !== null) {
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
