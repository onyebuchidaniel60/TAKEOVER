import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { authChallenges, providerProfiles, sessions, users } from '../../../../db/schema';
import { CHALLENGE_TTL_MS, createNonce, formatChallenge, SESSION_TTL_MS } from '../auth/challenge';
import { canonicalizeNimiqAddress, InvalidAddressError } from '../auth/nimiq-address';
import { createSessionToken } from '../auth/session-token';
import type { VerifySignatureFn } from '../auth/nimiq-verify';
import { verifyNimiqSignature } from '../auth/nimiq-verify';
import { isAdminWallet } from '../auth/admin';
import { writeAuditEvent } from '../audit/events';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_CHALLENGE_RATE_LIMIT,
  DEFAULT_VERIFY_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';

const challengeBodySchema = z.object({ walletAddress: z.string().min(1).max(64) }).strict();

const verifyBodySchema = z
  .object({
    walletAddress: z.string().min(1).max(64),
    nonce: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1).max(512),
    publicKey: z.string().min(1).max(256).optional(),
  })
  .strict();

export interface AuthRouteOptions {
  /** Injected for tests; production always uses the real Nimiq verifier. */
  verifySignature?: VerifySignatureFn;
  rateLimit?: {
    challenge?: RateLimitOptions;
    verify?: RateLimitOptions;
  };
}

function canonicalizeOr400(value: string): string {
  try {
    return canonicalizeNimiqAddress(value);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid wallet address.');
    }
    throw err;
  }
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const verifySignature = opts.verifySignature ?? verifyNimiqSignature;
  const challengeLimiter = createRateLimiter(
    opts.rateLimit?.challenge ?? DEFAULT_CHALLENGE_RATE_LIMIT,
  );
  const verifyLimiter = createRateLimiter(opts.rateLimit?.verify ?? DEFAULT_VERIFY_RATE_LIMIT);

  app.post(
    '/auth/challenge',
    { preHandler: challengeLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const parsed = challengeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const walletAddress = canonicalizeOr400(parsed.data.walletAddress);
      const db = getDb();
      const nonce = createNonce();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MS);
      const inserted = await db
        .insert(authChallenges)
        .values({ walletAddress, nonce, expiresAt, createdAt })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
      }
      return successBody(request, {
        challenge: formatChallenge(row.nonce, row.createdAt),
        nonce: row.nonce,
        expiresAt: row.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    '/auth/verify',
    { preHandler: verifyLimiter, bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const parsed = verifyBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const walletAddress = canonicalizeOr400(parsed.data.walletAddress);
      const db = getDb();

      const challengeRows = await db
        .select()
        .from(authChallenges)
        .where(
          and(
            eq(authChallenges.nonce, parsed.data.nonce),
            eq(authChallenges.walletAddress, walletAddress),
            isNull(authChallenges.consumedAt),
          ),
        )
        .limit(1);
      const challenge = challengeRows[0];
      if (!challenge) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired challenge.');
      }
      if (challenge.expiresAt.getTime() <= Date.now()) {
        throw new AppError(401, 'AUTH_EXPIRED', 'Challenge has expired.');
      }

      const message = formatChallenge(challenge.nonce, challenge.createdAt);
      const ok = await verifySignature({
        address: walletAddress,
        message,
        signature: parsed.data.signature,
        publicKey: parsed.data.publicKey,
      });
      if (!ok) {
        // Failed attempts do not burn the challenge; the rate limiter bounds retries.
        throw new AppError(401, 'UNAUTHENTICATED', 'Signature verification failed.');
      }

      // Single-use: exactly one verify may consume the nonce (race-safe).
      const consumed = await db
        .update(authChallenges)
        .set({ consumedAt: new Date() })
        .where(and(eq(authChallenges.id, challenge.id), isNull(authChallenges.consumedAt)))
        .returning({ id: authChallenges.id });
      if (consumed.length === 0) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired challenge.');
      }

      // Admin promotion: an allowlisted wallet becomes admin on
      // verify. Never auto-demote — a non-listed wallet keeps its stored role.
      const allowlisted = isAdminWallet(walletAddress);
      const authResult = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({ walletAddress, role: allowlisted ? 'admin' : 'buyer' })
          .onConflictDoNothing()
          .returning();
        const fresh = inserted[0];
        if (fresh) {
          // First-time upsert only: audit user.created inside the same
          // transaction as the user row (succeed or fail together).
          await writeAuditEvent(tx, {
            actorUserId: fresh.id,
            eventType: 'user.created',
            entityType: 'user',
            entityId: fresh.id,
            requestId: request.id,
            metadata: { role: fresh.role },
          });
          return { user: fresh, created: true as const };
        }
        const existing =
          (await tx.select().from(users).where(eq(users.walletAddress, walletAddress)).limit(1))[0];
        if (!existing) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
        }
        if (allowlisted && existing.role !== 'admin') {
          const promoted = await tx
            .update(users)
            .set({ role: 'admin', updatedAt: new Date() })
            .where(eq(users.id, existing.id))
            .returning();
          const row = promoted[0] ?? existing;
          return { user: row, created: false as const };
        }
        return { user: existing, created: false as const };
      });
      const user = authResult.user;
      if (user.status !== 'active' || user.disabledAt !== null) {
        throw new AppError(403, 'USER_DISABLED', 'This account is disabled.');
      }

      const token = createSessionToken();
      await db.insert(sessions).values({
        id: token.sessionId,
        userId: user.id,
        tokenHash: token.secretHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      setSessionCookie(reply, token.token);
      // Bearer fallback (owner approved): the raw session token is
      // ALSO returned in the body for hosts that drop the third-party session
      // cookie (Nimiq Pay Android WebView). Same token, same session row, same
      // TTL/revocation as the cookie. Never logged; never returned anywhere
      // else; the frontend keeps it in sessionStorage only.
      return successBody(request, {
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          role: user.role,
          status: user.status,
        },
        sessionToken: token.token,
      });
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const user = await requireAuth(request);
    const db = getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, user.sessionId));
    clearSessionCookie(reply);
    return successBody(request, { ok: true });
  });

  app.get('/me', async (request) => {
    const user = await requireAuth(request);
    const db = getDb();
    const profiles = await db
      .select({ displayName: providerProfiles.displayName })
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, user.id))
      .limit(1);
    const profile = profiles[0];
    const userRows = await db
      .select({ avatarData: users.avatarData })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return successBody(request, {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        role: user.role,
        status: user.status,
        hasProviderProfile: profiles.length > 0,
        providerProfile: profile ? { displayName: profile.displayName } : null,
        avatarData: userRows[0]?.avatarData ?? null,
      },
    });
  });
}
