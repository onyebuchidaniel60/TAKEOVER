// Own-slot claim guard (live DB): the slot's provider cannot claim their
// own slot — 403 CANNOT_CLAIM_OWN_SLOT from inside the locked claim
// transaction, before the live-claim check. Fixtures use unique per-run
// tags; everything created here is deleted afterwards in batches.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('own-slot claim guard (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
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

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  async function loginAs(wallet: string): Promise<string> {
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
    return sessionCookieFrom(verify);
  }

  async function loginAdmin(): Promise<{ cookie: string; userId: string }> {
    const wallet = randomWallet();
    process.env.ADMIN_WALLET_ADDRESSES = wallet;
    try {
      const cookie = await loginAs(wallet);
      const userId = await userIdFor(wallet);
      return { cookie, userId };
    } finally {
      delete process.env.ADMIN_WALLET_ADDRESSES;
    }
  }

  async function userIdFor(wallet: string): Promise<string> {
    const db = getDb();
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  // Each slot gets its own provider (identified by wallet), so the
  // provider-login and buyer-login identities are exact.
  async function makeSlotFor(providerWallet: string): Promise<{ slotId: string; providerId: string }> {
    const db = getDb();
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
    }
    await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    const providerId = await userIdFor(providerWallet);
    const slotId = randomUUID();
    const now = Date.now();
    await db.insert(slots).values({
      id: slotId,
      providerId,
      title: `OWN ${tag} slot`,
      description: `OWN ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: `NQ00 OWNPAY${tag.toUpperCase()}`,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(slotId);
    return { slotId, providerId };
  }

  async function postClaim(cookie: string, slotId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  function errorOf(res: InjectResponse): { code: string; message: string } {
    return (res.json() as { error: { code: string; message: string } }).error;
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      await db.delete(claims).where(inArray(claims.slotId, slotIds));
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (wallets.length > 0) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.walletAddress, wallets));
      const userIds = found.map((u) => u.id);
      if (userIds.length > 0) {
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('a non-provider buyer can still claim (happy path regression)', { timeout: 30_000 }, async () => {
    const { slotId } = await makeSlotFor(randomWallet());
    const buyerCookie = await loginAs(randomWallet());
    const res = await postClaim(buyerCookie, slotId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { status: string } } }).data.claim.status).toBe('active_hold');
  });

  it('provider claiming their own slot → 403, zero rows, quantity untouched', { timeout: 30_000 }, async () => {
    const db = getDb();
    const providerWallet = randomWallet();
    const { slotId } = await makeSlotFor(providerWallet);
    const providerCookie = await loginAs(providerWallet);
    const res = await postClaim(providerCookie, slotId);
    expect(res.statusCode).toBe(403);
    const err = errorOf(res);
    expect(err.code).toBe('CANNOT_CLAIM_OWN_SLOT');
    expect(err.message).toBe('You cannot claim your own opening.');
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.availableQuantity).toBe(4);
  });

  it('two concurrent provider claims both 403 with zero rows', { timeout: 30_000 }, async () => {
    const db = getDb();
    const providerWallet = randomWallet();
    const { slotId } = await makeSlotFor(providerWallet);
    const providerCookie = await loginAs(providerWallet);
    const [a, b] = await Promise.all([postClaim(providerCookie, slotId), postClaim(providerCookie, slotId)]);
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(errorOf(a).code).toBe('CANNOT_CLAIM_OWN_SLOT');
    expect(errorOf(b).code).toBe('CANNOT_CLAIM_OWN_SLOT');
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.availableQuantity).toBe(4);
  });

  it('an admin who is not the provider can still claim (rule is per-user, not per-role)', { timeout: 30_000 }, async () => {
    const { slotId } = await makeSlotFor(randomWallet());
    const { cookie } = await loginAdmin();
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { status: string } } }).data.claim.status).toBe('active_hold');
  });

  it('a different user claims normally right after the provider is rejected (no poisoning)', { timeout: 30_000 }, async () => {
    const providerWallet = randomWallet();
    const { slotId } = await makeSlotFor(providerWallet);
    const rejected = await postClaim(await loginAs(providerWallet), slotId);
    expect(rejected.statusCode).toBe(403);
    const res = await postClaim(await loginAs(randomWallet()), slotId);
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.availableQuantity).toBe(3);
  });

  it('a provider with an anomalous pre-existing claim is rejected, not served the row', { timeout: 30_000 }, async () => {
    // Pre-fix data may exist; the guard runs before the idempotent-return
    // path on purpose — an own-slot claim is anomalous, not a fallback.
    const db = getDb();
    const providerWallet = randomWallet();
    const { slotId, providerId } = await makeSlotFor(providerWallet);
    await db.insert(claims).values({
      slotId,
      buyerId: providerId,
      quantity: 1,
      status: 'active_hold',
      holdExpiresAt: new Date(Date.now() + HOUR),
    });
    const res = await postClaim(await loginAs(providerWallet), slotId);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CANNOT_CLAIM_OWN_SLOT');
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(1);
  });

  it('ownership probe: owner true, stranger false, missing 404, anon 401', { timeout: 30_000 }, async () => {
    const providerWallet = randomWallet();
    const { slotId } = await makeSlotFor(providerWallet);
    const ownerCookie = await loginAs(providerWallet);
    const strangerCookie = await loginAs(randomWallet());
    const owner = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${slotId}/ownership`,
      headers: { cookie: ownerCookie },
    });
    expect(owner.statusCode).toBe(200);
    expect((owner.json() as { data: { isOwner: boolean } }).data.isOwner).toBe(true);
    const stranger = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${slotId}/ownership`,
      headers: { cookie: strangerCookie },
    });
    expect(stranger.statusCode).toBe(200);
    expect((stranger.json() as { data: { isOwner: boolean } }).data.isOwner).toBe(false);
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${randomUUID()}/ownership`,
      headers: { cookie: strangerCookie },
    });
    expect(missing.statusCode).toBe(404);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}/ownership` });
    expect(anon.statusCode).toBe(401);
  });
});
