import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, sessions, users } from '../../../db/schema';

// Live integration + security suite for wallet authentication.
// The signature verifier is injected (mutable stub) so every state transition
// is deterministic. Production wires the real Nimiq verifier (see handoff);
// these tests prove the surrounding state machine, not cryptography
// (cryptography is proven by test/crypto.test.ts against real vectors).
describe.skipIf(!isDatabaseConfigured())('wallet auth (live)', () => {
  let stubResult = true;
  const stubVerifier: VerifySignatureFn = () => stubResult;

  // Generous limits: many tests share one loopback IP; the limiter itself is
  // proven by the dedicated rate-limit test below with tiny thresholds.
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
    },
  });

  const wallets = new Set<string>();

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.add(wallet);
    return wallet;
  }

  afterEach(async () => {
    stubResult = true;
    const db = getDb();
    for (const wallet of wallets) {
      const found = await db.select().from(users).where(eq(users.walletAddress, wallet)).limit(1);
      if (found[0]) {
        // Phase 10 audit rows reference their actor: remove them first.
        await db.delete(auditEvents).where(eq(auditEvents.actorUserId, found[0].id));
        await db.delete(sessions).where(eq(sessions.userId, found[0].id));
        await db.delete(authChallenges).where(eq(authChallenges.walletAddress, wallet));
        await db.delete(users).where(eq(users.id, found[0].id));
      } else {
        await db.delete(authChallenges).where(eq(authChallenges.walletAddress, wallet));
      }
    }
    wallets.clear();
  });

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string | undefined {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
  }

  async function challengeFor(wallet: string): Promise<{ nonce: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { challenge: string; nonce: string; expiresAt: string };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.nonce).toMatch(/^[0-9a-f]{64}$/);
    return { nonce: body.data.nonce };
  }

  async function verifyAs(
    wallet: string,
    nonce: string,
    target: FastifyInstance = app,
  ): Promise<InjectResponse> {
    return target.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
  }

  it('creates a challenge with the envelope and persists the row', async () => {
    const wallet = randomWallet();
    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet.toLowerCase() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { challenge: string; nonce: string; expiresAt: string };
      requestId: string;
    };
    expect(body.data.challenge).toContain(body.data.nonce);
    const db = getDb();
    const rows = await db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.nonce, body.data.nonce));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.walletAddress).toBe(wallet);
    expect(rows[0]?.consumedAt).toBeNull();
    const skew = Math.abs((rows[0]?.expiresAt.getTime() ?? 0) - (before + 5 * 60 * 1000));
    expect(skew).toBeLessThan(60_000);
  });

  it('binds the challenge to the wallet: mismatched walletAddress fails', async () => {
    const wallet = randomWallet();
    const other = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const res = await verifyAs(other, nonce);
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.requestId).toBe('string');
  });

  it('rejects an expired challenge with AUTH_EXPIRED', async () => {
    const wallet = randomWallet();
    const nonce = 'e'.repeat(64);
    const db = getDb();
    await db.insert(authChallenges).values({
      walletAddress: wallet,
      nonce,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const res = await verifyAs(wallet, nonce);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AUTH_EXPIRED');
  });

  it('makes challenges single-use: replaying the nonce fails', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const first = await verifyAs(wallet, nonce);
    expect(first.statusCode).toBe(200);
    const second = await verifyAs(wallet, nonce);
    expect(second.statusCode).toBe(401);
    expect((second.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    const db = getDb();
    const rows = await db.select().from(authChallenges).where(eq(authChallenges.nonce, nonce));
    expect(rows[0]?.consumedAt).not.toBeNull();
  });

  it('does not burn the challenge on a failed attempt', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    stubResult = false;
    const failed = await verifyAs(wallet, nonce);
    expect(failed.statusCode).toBe(401);
    stubResult = true;
    const retry = await verifyAs(wallet, nonce);
    expect(retry.statusCode).toBe(200);
  });

  it('rejects an invalid signature with 401 UNAUTHENTICATED', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    stubResult = false;
    const res = await verifyAs(wallet, nonce);
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string }; requestId: string };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.requestId).toBe('string');
  });

  it('creates the user, session, and cookie on a valid signature', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const before = Date.now();
    const res = await verifyAs(wallet, nonce);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { user: { id: string; walletAddress: string; role: string; status: string } };
      requestId: string;
    };
    expect(body.data.user.walletAddress).toBe(wallet);
    expect(body.data.user.role).toBe('buyer');
    expect(body.data.user.status).toBe('active');
    const cookie = sessionCookieFrom(res);
    expect(cookie?.startsWith('takeover_session=')).toBe(true);

    const db = getDb();
    const userRows = await db.select().from(users).where(eq(users.walletAddress, wallet));
    expect(userRows).toHaveLength(1);
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userRows[0]?.id ?? ''));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.revokedAt).toBeNull();
    const skew = Math.abs(
      (sessionRows[0]?.expiresAt.getTime() ?? 0) - (before + 7 * 24 * 60 * 60 * 1000),
    );
    expect(skew).toBeLessThan(60_000);
  });

  it('returns 401 for /me without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the user for /me with a valid cookie', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    expect(cookie).toBeDefined();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { user: { walletAddress: string; hasProviderProfile: boolean } };
    };
    expect(body.data.user.walletAddress).toBe(wallet);
    expect(body.data.user.hasProviderProfile).toBe(false);
  });

  it('revokes server-side on logout: /me fails and revoked_at is set', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie ?? '' },
    });
    expect(logout.statusCode).toBe(200);
    expect((logout.json() as { data: { ok: boolean } }).data.ok).toBe(true);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(after.statusCode).toBe(401);

    const db = getDb();
    const sessionRows = await db.select().from(sessions);
    const revoked = sessionRows.filter((s) => s.revokedAt !== null);
    expect(revoked.length).toBeGreaterThan(0);
  });

  it('rejects a forged token (valid sessionId, wrong secret)', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    expect(cookie).toBeDefined();
    const sessionId = (cookie ?? '').split('=')[1]?.split('.')[0] ?? '';
    const forged = `takeover_session=${sessionId}.${'A'.repeat(43)}`;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: forged },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    const db = getDb();
    const userRows = await db.select().from(users).where(eq(users.walletAddress, wallet));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userRows[0]?.id ?? ''));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a revoked session on reuse', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie ?? '' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to authenticate a disabled account with USER_DISABLED', async () => {
    const wallet = randomWallet();
    const db = getDb();
    await db.insert(users).values({ walletAddress: wallet, status: 'disabled' });
    const { nonce } = await challengeFor(wallet);
    const res = await verifyAs(wallet, nonce);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('USER_DISABLED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('treats a user disabled after login as unauthenticated', async () => {
    const wallet = randomWallet();
    const { nonce } = await challengeFor(wallet);
    const login = await verifyAs(wallet, nonce);
    const cookie = sessionCookieFrom(login);
    const db = getDb();
    await db.update(users).set({ status: 'disabled' }).where(eq(users.walletAddress, wallet));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('handles SQL injection attempts as plain validation errors', async () => {
    const injection = "' OR '1'='1";
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: injection },
    });
    expect(challengeRes.statusCode).toBe(400);
    expect((challengeRes.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: injection, nonce: 'a'.repeat(64), signature: 's' },
    });
    expect(verifyRes.statusCode).toBe(400);
  });

  it('rejects missing, unknown, malformed, and oversized bodies', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const wallet = randomWallet();
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet, role: 'admin' },
    });
    expect(unknown.statusCode).toBe(400);

    const badNonce = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce: 'not-a-nonce', signature: 's' },
    });
    expect(badNonce.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: `NQ${'0'.repeat(20000)}` },
    });
    expect(oversized.statusCode).toBe(413);
    expect((oversized.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
  });

  it('rate-limits challenge creation with 429 RATE_LIMITED', async () => {
    const limited = buildApp({
      verifySignature: stubVerifier,
      rateLimit: { challenge: { windowMs: 60_000, max: 3 } },
    });
    try {
      const wallet = randomWallet();
      for (let i = 0; i < 3; i += 1) {
        const res = await limited.inject({
          method: 'POST',
          url: '/api/v1/auth/challenge',
          payload: { walletAddress: wallet },
        });
        expect(res.statusCode).toBe(200);
      }
      const blocked = await limited.inject({
        method: 'POST',
        url: '/api/v1/auth/challenge',
        payload: { walletAddress: wallet },
      });
      expect(blocked.statusCode).toBe(429);
      const body = blocked.json() as { error: { code: string }; requestId: string };
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(typeof body.requestId).toBe('string');
    } finally {
      await limited.close();
    }
  });
});
