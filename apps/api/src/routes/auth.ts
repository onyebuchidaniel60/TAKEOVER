import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { authChallenges, providerProfiles, sessions, users } from '../../../../db/schema';
import { CHALLENGE_TTL_MS, createNonce, formatChallenge, SESSION_TTL_MS } from '../auth/challenge';
import { canonicalizeNimiqAddress, InvalidAddressError } from '../auth/nimiq-address';
import { createSessionToken } from '../auth/session-token';
import { hashPassword, validatePassword, verifyPassword } from '../auth/password';
import { validateEmail, validateUsername } from '../auth/identity';
import { isUniqueViolation } from '../claims/service';
import type { VerifySignatureFn } from '../auth/nimiq-verify';
import { verifyNimiqSignature } from '../auth/nimiq-verify';
import { isAdminWallet } from '../auth/admin';
import { writeAuditEvent } from '../audit/events';
import { clearSessionCookie, issueSession, requireAuth, setSessionCookie } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createKeyedRateLimiter,
  createRateLimiter,
  DEFAULT_CHALLENGE_RATE_LIMIT,
  DEFAULT_LOGIN_EMAIL_FAILURE_RATE_LIMIT,
  DEFAULT_LOGIN_RATE_LIMIT,
  DEFAULT_REGISTER_RATE_LIMIT,
  DEFAULT_USERNAME_AVAILABLE_RATE_LIMIT,
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

// Email identity bodies are intentionally loose at the zod layer (plain
// strings): the pure validators in auth/identity.ts own the shape rules so
// HTTP, unit, and future onboarding code share one policy.
const registerBodySchema = z
  .object({ email: z.string(), password: z.string(), username: z.string() })
  .strict();

const loginBodySchema = z.object({ email: z.string(), password: z.string() }).strict();

const usernameAvailableQuerySchema = z.object({ username: z.string().min(1).max(64) }).strict();

/** Public identity projection for email-auth responses (no hash, no PII beyond the login identifiers). */
function toIdentityUserView(user: typeof users.$inferSelect): {
  id: string;
  email: string | null;
  username: string | null;
  walletAddress: string | null;
  role: 'buyer' | 'provider' | 'admin';
  status: 'active' | 'disabled';
} {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    walletAddress: user.walletAddress,
    role: user.role,
    status: user.status,
  };
}

function passwordErrorMessage(reason: string): string {
  if (reason === 'too_short') {
    return 'Password must be at least 8 characters.';
  }
  if (reason === 'matches_email') {
    return 'Password must not match your email.';
  }
  if (reason === 'matches_username') {
    return 'Password must not match your username.';
  }
  return 'Invalid password.';
}

export interface AuthRouteOptions {
  /** Injected for tests; production always uses the real Nimiq verifier. */
  verifySignature?: VerifySignatureFn;
  rateLimit?: {
    challenge?: RateLimitOptions;
    verify?: RateLimitOptions;
    /** Email registration budget (default 5/IP/hour). */
    register?: RateLimitOptions;
    /** Email login budget (default 10/IP/15min). */
    login?: RateLimitOptions;
    /** Per-email login-failure budget (default 5/email/15min). */
    loginEmailFailure?: RateLimitOptions;
    /** Username live-check budget (default 30/IP/min). */
    usernameAvailable?: RateLimitOptions;
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
  const registerLimiter = createRateLimiter(opts.rateLimit?.register ?? DEFAULT_REGISTER_RATE_LIMIT);
  const loginLimiter = createRateLimiter(opts.rateLimit?.login ?? DEFAULT_LOGIN_RATE_LIMIT);
  const loginEmailFailureBudget = createKeyedRateLimiter(
    opts.rateLimit?.loginEmailFailure ?? DEFAULT_LOGIN_EMAIL_FAILURE_RATE_LIMIT,
  );
  const usernameAvailableLimiter = createRateLimiter(
    opts.rateLimit?.usernameAvailable ?? DEFAULT_USERNAME_AVAILABLE_RATE_LIMIT,
  );

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

  // Email registration (Phase 5g dual identity). Creates a wallet-less user
  // (wallet_address NULL) plus a session via the SAME issuance path, cookie,
  // and body sessionToken field as the wallet flow — no new auth surface.
  // First-claim-wins linking (D4): an email or username already on ANY
  // account — wallet or email — is rejected, never merged.
  app.post(
    '/auth/register',
    { preHandler: registerLimiter, bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const emailChecked = validateEmail(parsed.data.email);
      if (!emailChecked.ok) {
        throw new AppError(400, 'INVALID_INPUT', 'Enter a valid email address.');
      }
      const usernameChecked = validateUsername(parsed.data.username);
      if (!usernameChecked.ok) {
        throw new AppError(
          400,
          'INVALID_INPUT',
          usernameChecked.reason === 'reserved'
            ? 'This username is reserved.'
            : 'Usernames are 3-20 lowercase letters, numbers, or underscores.',
        );
      }
      const email = emailChecked.value;
      const username = usernameChecked.value;
      const passwordChecked = validatePassword(parsed.data.password, { email, username });
      if (!passwordChecked.ok) {
        throw new AppError(400, 'INVALID_INPUT', passwordErrorMessage(passwordChecked.reason));
      }
      const db = getDb();
      // Fail fast before hashing: the UNIQUE backstop below maps a lost
      // registration race to the same codes (TOCTOU-safe).
      const emailHit = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (emailHit[0]) {
        throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered.');
      }
      const usernameHit = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (usernameHit[0]) {
        throw new AppError(409, 'USERNAME_TAKEN', 'This username is already taken.');
      }
      const passwordHash = await hashPassword(parsed.data.password);
      let user: typeof users.$inferSelect;
      try {
        user = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(users)
            .values({ email, passwordHash, username, walletAddress: null, role: 'buyer' })
            .returning();
          const row = inserted[0];
          if (!row) {
            throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
          }
          // Same-tx audit as the wallet flow's user.created: the row and
          // its audit event succeed or fail together. No password, no
          // email in the metadata (privacy rule).
          await writeAuditEvent(tx, {
            actorUserId: row.id,
            eventType: 'user.created',
            entityType: 'user',
            entityId: row.id,
            requestId: request.id,
            metadata: { auth_method: 'email' },
          });
          return row;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const [emailRace, usernameRace] = await Promise.all([
            db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
            db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1),
          ]);
          if (emailRace[0]) {
            throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered.');
          }
          if (usernameRace[0]) {
            throw new AppError(409, 'USERNAME_TAKEN', 'This username is already taken.');
          }
        }
        throw err;
      }
      const { token } = await issueSession(db, user.id);
      setSessionCookie(reply, token);
      return successBody(request, { user: toIdentityUserView(user), sessionToken: token });
    },
  );

  // Email login. Unknown email and wrong password produce the IDENTICAL
  // 401 UNAUTHENTICATED (no enumeration); wallet-only users (password_hash
  // NULL) fail the same way. Disabled users hear ACCOUNT_DISABLED.
  app.post(
    '/auth/login',
    { preHandler: loginLimiter, bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      // Malformed emails still cost an IP-budget unit (preHandler) but are
      // rejected before any DB read or per-email accounting.
      const emailChecked = validateEmail(parsed.data.email);
      if (!emailChecked.ok || typeof parsed.data.password !== 'string') {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password.');
      }
      const email = emailChecked.value;
      const db = getDb();
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const candidate = rows[0];
      const passwordOk =
        candidate?.passwordHash != null
          ? await verifyPassword(parsed.data.password, candidate.passwordHash)
          : false;
      if (!candidate || !passwordOk) {
        // Failures-only per-email budget: targeted brute force against one
        // inbox burns the small budget; legitimate retries from a shared IP
        // are unaffected by other users' failures.
        loginEmailFailureBudget.consume(email);
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid email or password.');
      }
      if (candidate.status !== 'active' || candidate.disabledAt !== null) {
        throw new AppError(401, 'ACCOUNT_DISABLED', 'This account is disabled.');
      }
      const { token } = await db.transaction(async (tx) => {
        const issued = await issueSession(tx, candidate.id);
        await writeAuditEvent(tx, {
          actorUserId: candidate.id,
          eventType: 'user.logged_in',
          entityType: 'user',
          entityId: candidate.id,
          requestId: request.id,
          metadata: { auth_method: 'email' },
        });
        return issued;
      });
      setSessionCookie(reply, token);
      return successBody(request, { user: toIdentityUserView(candidate), sessionToken: token });
    },
  );

  // Live username check for the onboarding flow (Phase 5j). Public by
  // design — usernames are public handles, so availability inherently
  // enumerates; the reason enum stays stable ('format' | 'reserved' |
  // 'taken') and never leaks which account holds a taken name.
  app.get(
    '/auth/username-available',
    { preHandler: usernameAvailableLimiter },
    async (request) => {
      const parsed = usernameAvailableQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
      }
      const checked = validateUsername(parsed.data.username);
      if (!checked.ok) {
        return successBody(request, {
          available: false,
          reason: checked.reason === 'reserved' ? 'reserved' : 'format',
        });
      }
      const db = getDb();
      const hit = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, checked.value))
        .limit(1);
      if (hit[0]) {
        return successBody(request, { available: false, reason: 'taken' });
      }
      return successBody(request, { available: true });
    },
  );

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
