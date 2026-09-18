// Phase 14c Bearer fallback suite — live DB. The Bearer token is the SAME
// server session the cookie carries (same row, TTL, revocation); these tests
// prove the alternate presentation, the approved CSRF exemption (Bearer-only),
// and the cookie-present precedence rule. Auth goes through the real
// challenge/verify flow with an injected signature stub (cryptography is
// proven by crypto.test.ts + the @nimiq/core oracle).
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import {
  auditEvents,
  authChallenges,
  claims,
  paymentIntents,
  providerProfiles,
  sessions,
  slots,
  users,
} from '../../../db/schema';

// Remote-Postgres latency: 30s budget per test (Phase 10 precedent).
vi.setConfig({ testTimeout: 30000 });

// Vitest runs with cwd = apps/api, so anchor the source scan there.
const API_SRC = resolve(process.cwd(), 'src');

describe.skipIf(!isDatabaseConfigured())('phase 14c bearer fallback (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  // Shared app: every budget disabled (budgets are proven by dedicated tests).
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerProfile: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
      admin: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.push(wallet);
    return wallet;
  }

  function validPayout(): string {
    return deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
  }

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  function fullSetCookieHeader(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='));
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  async function loginAs(
    wallet: string,
    target: FastifyInstance = app,
  ): Promise<{ cookie: string; token: string }> {
    const challenge = await target.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const verify = await target.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { data: { sessionToken: string } };
    return { cookie: sessionCookieFrom(verify), token: body.data.sessionToken };
  }

  async function userIdFor(wallet: string): Promise<string> {
    const db = getDb();
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlot(): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 B14CPROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `B14C ${tag} slot`,
      description: `B14C ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      const foundClaims = await db
        .select({ id: claims.id })
        .from(claims)
        .where(inArray(claims.slotId, slotIds));
      const claimIds = foundClaims.map((c) => c.id);
      if (claimIds.length > 0) {
        await db.delete(paymentIntents).where(inArray(paymentIntents.claimId, claimIds));
        await db.delete(claims).where(inArray(claims.id, claimIds));
      }
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (wallets.length > 0) {
      const found = await db.select({ id: users.id }).from(users).where(inArray(users.walletAddress, wallets));
      const userIds = found.map((u) => u.id);
      if (userIds.length > 0) {
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(providerProfiles).where(inArray(providerProfiles.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('verify body carries the session token and the Set-Cookie is unchanged', async () => {
    const wallet = randomWallet();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { data: { sessionToken: string } };
    // Same <sessionId>.<secret> shape the cookie carries.
    expect(body.data.sessionToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const header = fullSetCookieHeader(verify);
    // Cookie emitted unchanged (dev flags here; prod flags pinned separately):
    // the cookie value IS the body token.
    expect(header.split(';')[0]).toBe(`takeover_session=${body.data.sessionToken}`);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
  });

  it('bearer: GET /me succeeds with no cookie sent', async () => {
    const wallet = randomWallet();
    const { token } = await loginAs(wallet);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { user: { walletAddress: string } } };
    expect(body.data.user.walletAddress).toBe(wallet);
  });

  it('BEARER EXEMPTION: Bearer-only credentialed POST with no Origin and no client header succeeds', async () => {
    // The specific test proving the approved exemption path is reachable and
    // correct: no cookie, no Origin, no X-Takeover-Client — only the Bearer
    // token, which is never auto-attached and cannot be read cross-origin.
    const wallet = randomWallet();
    const { token } = await loginAs(wallet);
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { id: string } } }).data.claim.id).toBeDefined();
  });

  it('cookie path intact: cookie-bearing credentialed POST with no Origin is rejected', async () => {
    const { cookie } = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN');
    const db = getDb();
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
  });

  it('PRECEDENCE: valid cookie plus valid Bearer with a bad Origin is rejected', async () => {
    // Cookie present means the cookie path is active: the guard applies even
    // when a valid Bearer token rides along.
    const { cookie, token } = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: {
        cookie,
        authorization: `Bearer ${token}`,
        origin: 'https://evil.test',
        'x-takeover-client': 'web',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN');
    const db = getDb();
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
  });

  it('logout via cookie revokes the session; the Bearer path then 401s', async () => {
    const { cookie, token } = await loginAs(randomWallet());
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, ...CSRF },
    });
    expect(logout.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('logout via Bearer revokes the session; the cookie path then 401s', async () => {
    const { cookie, token } = await loginAs(randomWallet());
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(401);
  });

  it('forged Bearer (valid session id, wrong secret) is rejected', async () => {
    const { token } = await loginAs(randomWallet());
    const sessionId = token.split('.')[0] ?? '';
    const wrongSecret = randomBytes(32).toString('base64url');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${sessionId}.${wrongSecret}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('expired session via Bearer is rejected', async () => {
    const wallet = randomWallet();
    const { token } = await loginAs(wallet);
    const db = getDb();
    const userRows = await db.select().from(users).where(eq(users.walletAddress, wallet));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userRows[0]?.id ?? ''));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('revoked session via Bearer is rejected', async () => {
    const wallet = randomWallet();
    const { token } = await loginAs(wallet);
    const db = getDb();
    const userRows = await db.select().from(users).where(eq(users.walletAddress, wallet));
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, userRows[0]?.id ?? ''));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('disabled user via Bearer hears ACCOUNT_DISABLED', async () => {
    const wallet = randomWallet();
    const { token } = await loginAs(wallet);
    const db = getDb();
    await db.update(users).set({ status: 'disabled' }).where(eq(users.walletAddress, wallet));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('malformed Bearer values are rejected without authenticating', async () => {
    await loginAs(randomWallet());
    for (const header of [
      'Bearer',
      'Bearer ',
      'Token abc.def',
      'Bearer not-a-token',
      'Bearer Basic abc',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('secret hygiene: the session token value never appears in a log call', async () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          const lines = text.split('\n');
          lines.forEach((line, idx) => {
            if (/request\.log\.\w+\(/.test(line) && /sessionToken|authorization|bearer/i.test(line)) {
              offenders.push(`${full}:${idx + 1}: log carries the session token`);
            }
            if (/console\.log|console\.dir|console\.table/.test(line)) {
              offenders.push(`${full}:${idx + 1}: console output`);
            }
          });
        }
      }
    };
    walk(API_SRC);
    expect(offenders).toEqual([]);
  });
});
