// Phase 6 integration tests — live DB. Auth goes through the real
// challenge/verify flow with an injected signature stub (cryptography itself
// is proven by crypto.test.ts + the @nimiq/core oracle). Fixtures use unique
// per-run tags; everything created here is deleted afterwards in batches.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { authChallenges, claims, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('atomic claims (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

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

  async function userIdFor(wallet: string): Promise<string> {
    const db = getDb();
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlot(overrides: {
    title?: string;
    status?: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired';
    startsAt?: Date;
    total?: number;
    available?: number;
  } = {}): Promise<string> {
    const db = getDb();
    const now = Date.now();
    // One shared provider per run (role stays buyer: ownership, not role,
    // is what makes a provider). Tracked for cleanup via the wallets list.
    const providerWallet = `NQ00 P6PROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: overrides.title ?? `P6 ${tag} slot`,
      description: `P6 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: overrides.startsAt ?? new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: 150000n,
      totalQuantity: overrides.total ?? 4,
      availableQuantity: overrides.available ?? overrides.total ?? 4,
      payoutWallet: `NQ00 P6PAYOUT${tag.toUpperCase()}`,
      status: overrides.status ?? 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function postClaim(cookie: string | undefined, slotId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      ...(cookie ? { headers: { cookie } } : {}),
      payload: {},
    });
  }

  async function forceExpiry(slotId: string): Promise<void> {
    const db = getDb();
    await db
      .update(claims)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.slotId, slotId));
  }

  async function readSlot(slotId: string): Promise<typeof slots.$inferSelect> {
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    if (!rows[0]) throw new Error('expected slot row');
    return rows[0];
  }

  async function readClaims(slotId: string): Promise<(typeof claims.$inferSelect)[]> {
    const db = getDb();
    return db.select().from(claims).where(eq(claims.slotId, slotId));
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
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('claims a published slot: hold + decrement + envelope', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 4, available: 4 });
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        claim: Record<string, unknown>;
        slot: Record<string, unknown>;
      };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.claim['status']).toBe('active_hold');
    expect(body.data.claim['quantity']).toBe(1);
    // Both timestamps are server-side: the hold must span exactly the TTL.
    const holdMs =
      new Date(body.data.claim['hold_expires_at'] as string).getTime() -
      new Date(body.data.claim['claimed_at'] as string).getTime();
    expect(holdMs).toBeGreaterThanOrEqual(599_999);
    expect(holdMs).toBeLessThanOrEqual(600_001);
    expect(body.data.slot['available_quantity']).toBe(3);
    expect(body.data.slot['status']).toBe('published');
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(3);
  });

  it('flips to sold_out when the final unit is claimed', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 1, available: 1 });
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['available_quantity']).toBe(0);
    expect(body.data.slot['status']).toBe('sold_out');
  });

  it('races N buyers for one unit: exactly one wins', { timeout: 60_000 }, async () => {
    const slotId = await makeSlot({ total: 1, available: 1 });
    const buyers = 8;
    const cookies: string[] = [];
    for (let i = 0; i < buyers; i += 1) {
      cookies.push(await loginAs(randomWallet()));
    }
    const results = await Promise.all(cookies.map((cookie) => postClaim(cookie, slotId)));
    const won = results.filter((r) => r.statusCode === 200);
    const lost = results.filter((r) => r.statusCode === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(buyers - 1);
    for (const res of lost) {
      expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_UNAVAILABLE');
    }
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(0);
    expect(row.status).toBe('sold_out');
    expect(await readClaims(slotId)).toHaveLength(1);
  });

  it.each([
    ['sold_out', { status: 'sold_out' as const, total: 2, available: 0 }],
    ['draft', { status: 'draft' as const }],
    ['cancelled', { status: 'cancelled' as const }],
    ['past', { startsAt: new Date(Date.now() - HOUR) }],
  ])('rejects claiming a %s slot with 409 SLOT_UNAVAILABLE', async (_label, overrides) => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot(overrides);
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('returns 404 for a missing slot id', async () => {
    const cookie = await loginAs(randomWallet());
    const res = await postClaim(cookie, randomUUID());
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('returns the same claim on a duplicate POST without decrementing again', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    const first = await postClaim(cookie, slotId);
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { data: { claim: { id: string } } }).data.claim.id;
    const second = await postClaim(cookie, slotId);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: { claim: { id: string; status: string }; slot: { id: string } };
      requestId: string;
    };
    expect(typeof secondBody.requestId).toBe('string');
    expect(secondBody.data.claim.id).toBe(firstId);
    expect(secondBody.data.claim.status).toBe('active_hold');
    expect(secondBody.data.slot.id).toBe(slotId);
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
    expect(await readClaims(slotId)).toHaveLength(1);
  });

  it('returns an existing payment_pending claim idempotently', async () => {
    const db = getDb();
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const buyerId = await userIdFor(wallet);
    const slotId = await makeSlot({ total: 5, available: 5 });
    const inserted = await db
      .insert(claims)
      .values({
        slotId,
        buyerId,
        quantity: 1,
        status: 'payment_pending',
        holdExpiresAt: new Date(Date.now() + HOUR),
      })
      .returning({ id: claims.id });
    // One unit is reserved by the pre-existing hold.
    await db
      .update(slots)
      .set({ availableQuantity: 4 })
      .where(eq(slots.id, slotId));
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { claim: { id: string; status: string } } };
    expect(body.data.claim.id).toBe(inserted[0]?.id);
    expect(body.data.claim.status).toBe('payment_pending');
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
  });

  it('creates exactly one claim row for concurrent same-buyer POSTs', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    const [a, b] = await Promise.all([postClaim(cookie, slotId), postClaim(cookie, slotId)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const idA = (a.json() as { data: { claim: { id: string } } }).data.claim.id;
    const idB = (b.json() as { data: { claim: { id: string } } }).data.claim.id;
    expect(idA).toBe(idB);
    expect(await readClaims(slotId)).toHaveLength(1);
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
  });

  it('rejects unauthenticated claims with 401', async () => {
    const slotId = await makeSlot({});
    const res = await postClaim(undefined, slotId);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the buyer’s own claim with slot context', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({});
    const created = await postClaim(cookie, slotId);
    const claimId = (created.json() as { data: { claim: { id: string } } }).data.claim.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; slot: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.claim['id']).toBe(claimId);
    expect(body.data.slot['id']).toBe(slotId);
  });

  it('returns 404 CLAIM_NOT_FOUND for another user’s claim', async () => {
    const cookieA = await loginAs(randomWallet());
    const slotId = await makeSlot({});
    const created = await postClaim(cookieA, slotId);
    const claimId = (created.json() as { data: { claim: { id: string } } }).data.claim.id;
    const cookieB = await loginAs(randomWallet());
    const res = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}`, headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_FOUND');
  });

  it('requires auth for claim detail (401 anonymous)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/claims/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it('lists only the caller’s claims with an optional status filter', { timeout: 30_000 }, async () => {
    const cookieA = await loginAs(randomWallet());
    const cookieB = await loginAs(randomWallet());
    const slotA = await makeSlot({ title: `P6 ${tag} alpha` });
    const slotB = await makeSlot({ title: `P6 ${tag} beta` });
    await postClaim(cookieA, slotA);
    await postClaim(cookieB, slotB);
    const resA = await app.inject({ method: 'GET', url: '/api/v1/me/claims', headers: { cookie: cookieA } });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json() as {
      data: { claims: { slot_id: string; status: string }[]; total: number; limit: number; offset: number };
      requestId: string;
    };
    expect(typeof bodyA.requestId).toBe('string');
    expect(bodyA.data.claims.map((c) => c.slot_id)).toContain(slotA);
    expect(bodyA.data.claims.map((c) => c.slot_id)).not.toContain(slotB);
    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/me/claims?status=active_hold',
      headers: { cookie: cookieA },
    });
    expect(filtered.statusCode).toBe(200);
    for (const claim of (filtered.json() as { data: { claims: { status: string }[] } }).data.claims) {
      expect(claim.status).toBe('active_hold');
    }
  });

  it('expires a hold on detail view and restores one unit', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 2, available: 2 });
    await postClaim(cookie, slotId);
    expect((await readSlot(slotId)).availableQuantity).toBe(1);
    await forceExpiry(slotId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(res.statusCode).toBe(200);
    expect((await readClaims(slotId))[0]?.status).toBe('expired');
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
  });

  it('flips sold_out back to published when expiry restores stock', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 1, available: 1 });
    await postClaim(cookie, slotId);
    expect((await readSlot(slotId)).status).toBe('sold_out');
    await forceExpiry(slotId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(res.statusCode).toBe(200);
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(1);
    expect(row.status).toBe('published');
    expect((res.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');
  });

  it('restores exactly once across repeated sweeps', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 2, available: 2 });
    await postClaim(cookie, slotId);
    await forceExpiry(slotId);
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
    expect((await readClaims(slotId))[0]?.status).toBe('expired');
  });

  it('restores exactly once under concurrent sweeps', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 1, available: 1 });
    await postClaim(cookie, slotId);
    await forceExpiry(slotId);
    await Promise.all([
      app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` }),
      app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` }),
    ]);
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(1);
    expect(row.status).toBe('published');
  });

  it('includes sold_out slots in the public list', async () => {
    const slotId = await makeSlot({
      title: `P6 ${tag} gone supper`,
      status: 'sold_out',
      total: 4,
      available: 0,
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots?q=P6%20${tag}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slots: { id: string; status: string }[] } };
    const found = body.data.slots.find((s) => s.id === slotId);
    expect(found?.status).toBe('sold_out');
  });
});
