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
  sameSite: 'lax';
} {
  // Secure only in production so local HTTP development keeps working.
  // NOTE: if the Nimiq Mini App WebView drops Lax cookies on the cross-origin
  // production path (Vercel -> Railway), SameSite=None; Secure will be required
  // there instead. No bearer-token fallback unless cookies demonstrably fail.
  return { path: '/', httpOnly: true, secure: isProduction(), sameSite: 'lax' };
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
