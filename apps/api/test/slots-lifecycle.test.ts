// Phase 5 integration tests — live DB. Auth goes through the real
// challenge/verify flow with an injected signature stub (cryptography itself
// is proven by crypto.test.ts + the @nimiq/core oracle). Fixtures use unique
// per-run tags; everything created here is deleted afterwards.
import { afterAll, describe, expect, it, vi } from 'vitest';

// Phase 13 determinism: live-DB chains (login + mutations + verification
// reads) measure 2-5s per test against remote Postgres with spikes past 5s;
// observed failures were wall-clock timeouts only, scattered across tests
// and runs, never wrong values. File-level budget per the claims.test.ts
// precedent - not a logic fix.
vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('provider slot lifecycle (live)', () => {
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

  // Phase 12 completion (F4): the CSRF guard requires an allowlisted Origin
  // and the client header on every credentialed mutation. The test allowlist
  // is the dev default (CORS_ORIGINS unset here).
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const slotIds: string[] = [];

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

  function validDraftBody(title: string): Record<string, unknown> {
    const now = Date.now();
    const HOUR = 3_600_000;
    return {
      title,
      description: `P5 ${tag} description`,
      category: 'dining',
      location_label: 'Mitte',
      starts_at: new Date(now + 2 * HOUR).toISOString(),
      ends_at: new Date(now + 4 * HOUR).toISOString(),
      price_usdt: '150000',
      total_quantity: 4,
      payout_wallet: validPayout(),
    };
  }

  async function createDraft(cookie: string, title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: validDraftBody(title),
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(id);
    return id;
  }

  afterAll(async () => {
    const db = getDb();
    // Batched deletes: one statement per table so cleanup stays well under
    // the hook timeout even against remote Postgres.
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
        // Phase 10 audit rows reference their actor: remove them first.
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('rejects slot creation without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      payload: validDraftBody(`P5 ${tag} noauth`),
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a draft with available == total and no published_at', async () => {
    const cookie = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: validDraftBody(`P5 ${tag} draft`),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { slot: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.slot['status']).toBe('draft');
    expect(body.data.slot['available_quantity']).toBe(4);
    expect(body.data.slot['total_quantity']).toBe(4);
    expect(body.data.slot['published_at']).toBeNull();
    expect(typeof body.data.slot['payout_wallet']).toBe('string');
    slotIds.push(body.data.slot['id'] as string);
  });

  it('does not promote the creator role (stays buyer)', async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    await createDraft(cookie, `P5 ${tag} rolecheck`);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, ...CSRF } });
    expect((me.json() as { data: { user: { role: string } } }).data.user.role).toBe('buyer');
  });

  it('rejects a fixture payout wallet with 400 (bad checksum)', async () => {
    const cookie = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: { ...validDraftBody(`P5 ${tag} badpayout`), payout_wallet: 'NQ00 SEEDPAYOUT000000000001' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
  });

  it('edits its own draft', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} editme`);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${id}`,
      headers: { cookie, ...CSRF },
      payload: { title: `P5 ${tag} edited`, total_quantity: 6 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['title']).toBe(`P5 ${tag} edited`);
    expect(body.data.slot['total_quantity']).toBe(6);
    expect(body.data.slot['available_quantity']).toBe(6);
  });

  it('returns 404 when patching someone else’s draft', async () => {
    const ownerCookie = await loginAs(randomWallet());
    const id = await createDraft(ownerCookie, `P5 ${tag} notyours`);
    const otherCookie = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${id}`,
      headers: { cookie: otherCookie, ...CSRF },
      payload: { title: 'hijacked' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('rejects patching a published slot with 409 SLOT_NOT_EDITABLE', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} topublish`);
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/publish`,
      headers: { cookie, ...CSRF },
    });
    expect(published.statusCode).toBe(200);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${id}`,
      headers: { cookie, ...CSRF },
      payload: { title: 'too late' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_EDITABLE');
  });

  it('publishes its own draft (status + published_at set)', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} publishme`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/publish`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['status']).toBe('published');
    expect(typeof body.data.slot['published_at']).toBe('string');
  });

  it('rejects publishing an already-published slot with 409', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} twice`);
    await app.inject({ method: 'POST', url: `/api/v1/slots/${id}/publish`, headers: { cookie, ...CSRF } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/publish`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_PUBLISHABLE');
  });

  it('returns 404 when publishing someone else’s draft', async () => {
    const ownerCookie = await loginAs(randomWallet());
    const id = await createDraft(ownerCookie, `P5 ${tag} theirdraft`);
    const otherCookie = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/publish`,
      headers: { cookie: otherCookie, ...CSRF },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cancels its own draft (status + cancelled_at set)', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} canceldraft`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['status']).toBe('cancelled');
    expect(typeof body.data.slot).toBe('object');
  });

  // Explicit timeout: six sequential live-DB round trips against remote
  // Postgres (plus the Phase 10 cancel audit write) exceed the 5s default.
  it('cancels a published slot with no claims and releases active holds', { timeout: 30_000 }, async () => {
    const db = getDb();
    const ownerWallet = randomWallet();
    const ownerCookie = await loginAs(ownerWallet);
    const id = await createDraft(ownerCookie, `P5 ${tag} cancelpub`);
    await app.inject({ method: 'POST', url: `/api/v1/slots/${id}/publish`, headers: { cookie: ownerCookie, ...CSRF } });
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    void buyerCookie;
    const buyer = await db.select().from(users).where(eq(users.walletAddress, buyerWallet)).limit(1);
    await db.insert(claims).values({
      slotId: id,
      buyerId: buyer[0]?.id ?? '',
      quantity: 1,
      status: 'active_hold',
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie: ownerCookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('cancelled');
    const leftovers = await db.select().from(claims).where(eq(claims.slotId, id));
    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]?.status).toBe('cancelled');
  });

  // Explicit timeout: same sequential live-DB chain as above.
  it('blocks cancellation with 409 when a paid claim exists', { timeout: 30_000 }, async () => {
    const db = getDb();
    const ownerCookie = await loginAs(randomWallet());
    const id = await createDraft(ownerCookie, `P5 ${tag} paidblock`);
    await app.inject({ method: 'POST', url: `/api/v1/slots/${id}/publish`, headers: { cookie: ownerCookie, ...CSRF } });
    const buyerWallet = randomWallet();
    await loginAs(buyerWallet);
    const buyer = await db.select().from(users).where(eq(users.walletAddress, buyerWallet)).limit(1);
    await db.insert(claims).values({
      slotId: id,
      buyerId: buyer[0]?.id ?? '',
      quantity: 1,
      status: 'paid',
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie: ownerCookie, ...CSRF },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_CANCELLABLE');
  });

  it('blocks cancellation with 409 when a payment_pending claim exists', async () => {
    const db = getDb();
    const ownerCookie = await loginAs(randomWallet());
    const id = await createDraft(ownerCookie, `P5 ${tag} pendingblock`);
    await app.inject({ method: 'POST', url: `/api/v1/slots/${id}/publish`, headers: { cookie: ownerCookie, ...CSRF } });
    const buyerWallet = randomWallet();
    await loginAs(buyerWallet);
    const buyer = await db.select().from(users).where(eq(users.walletAddress, buyerWallet)).limit(1);
    await db.insert(claims).values({
      slotId: id,
      buyerId: buyer[0]?.id ?? '',
      quantity: 1,
      status: 'payment_pending',
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie: ownerCookie, ...CSRF },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_CANCELLABLE');
  });

  it('returns 404 when cancelling someone else’s slot', async () => {
    const ownerCookie = await loginAs(randomWallet());
    const id = await createDraft(ownerCookie, `P5 ${tag} canceltheirs`);
    const otherCookie = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie: otherCookie, ...CSRF },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /me/slots returns only the caller’s slots', async () => {
    const cookieA = await loginAs(randomWallet());
    const cookieB = await loginAs(randomWallet());
    const idA = await createDraft(cookieA, `P5 ${tag} mineA`);
    const idB = await createDraft(cookieB, `P5 ${tag} mineB`);
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/slots', headers: { cookie: cookieA, ...CSRF } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { slots: { id: string; payout_wallet: unknown }[]; total: number };
      requestId: string;
    };
    const found = body.data.slots.map((s) => s.id);
    expect(found).toContain(idA);
    expect(found).not.toContain(idB);
    for (const slot of body.data.slots) {
      expect(typeof slot.payout_wallet).toBe('string');
    }
  });

  it('GET /slots/:id as owner of a draft returns the owner projection', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} ownerdetail`);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${id}`, headers: { cookie, ...CSRF } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['id']).toBe(id);
    expect(typeof body.data.slot['payout_wallet']).toBe('string');
  });

  it('GET /slots/:id as anonymous on a draft stays 404', async () => {
    const cookie = await loginAs(randomWallet());
    const id = await createDraft(cookie, `P5 ${tag} anon404`);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${id}` });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
