// Integration tests — live DB. Auth goes through the real
// challenge/verify flow with an injected signature stub. Fixtures use unique
// per-run tags; everything created here is deleted afterwards in batches.
// Slots here use REAL canonical payout wallets: intent creation validates them.
import { afterAll, describe, expect, it, vi } from 'vitest';

// Determinism: live-DB chains (login + mutations + verification
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
import { auditEvents, authChallenges, claims, paymentIntents, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('payment intents and submission (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      // Budgets disabled here (proven separately in security.test.ts).
      claimCreate: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];

  // Completion (F4): the CSRF guard requires an allowlisted Origin
  // and the client header on every credentialed mutation. The test allowlist
  // is the dev default (CORS_ORIGINS unset here).
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

  /** Fresh 32-hex-char hash per test: the tx_hash UNIQUE index is global. */
  function freshHash(): string {
    return randomUUID().replace(/-/g, '');
  }

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

  async function userIdFor(wallet: string): Promise<string> {
    const db = getDb();
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlot(
    payout = validPayout(),
    overrides: { startsAt?: Date; total?: number; available?: number } = {},
  ): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 P7PROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `P7 ${tag} slot`,
      description: `P7 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: overrides.startsAt ?? new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: overrides.total ?? 4,
      availableQuantity: overrides.available ?? overrides.total ?? 4,
      payoutWallet: payout,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function claimAs(cookie: string, slotId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { claim: { id: string } } }).data.claim.id;
  }

  async function postIntent(cookie: string | undefined, claimId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: {},
    });
  }

  async function postSubmission(
    cookie: string | undefined,
    claimId: string,
    body: Record<string, unknown>,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: body,
    });
  }

  async function intentsForClaim(claimId: string): Promise<(typeof paymentIntents.$inferSelect)[]> {
    const db = getDb();
    return db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId));
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      const claimRows = await db
        .select({ id: claims.id })
        .from(claims)
        .where(inArray(claims.slotId, slotIds));
      const claimIds = claimRows.map((c) => c.id);
      if (claimIds.length > 0) {
        await db.delete(paymentIntents).where(inArray(paymentIntents.claimId, claimIds));
      }
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
        // Audit rows reference their actor: remove them first.
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('creates an intent on an active_hold claim without touching the claim', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const res = await postIntent(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { intent: Record<string, unknown>; claim: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.intent['status']).toBe('created');
    expect(body.data.intent['txHash']).toBeNull();
    expect(body.data.intent['submittedAt']).toBeNull();
    expect(body.data.claim['status']).toBe('active_hold');
    expect(body.data.claim['id']).toBe(claimId);
  });

  it('returns the same intent on repeat calls without a new row', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const first = await postIntent(cookie, claimId);
    const second = await postIntent(cookie, claimId);
    expect(second.statusCode).toBe(200);
    const idA = (first.json() as { data: { intent: { id: string } } }).data.intent.id;
    const idB = (second.json() as { data: { intent: { id: string } } }).data.intent.id;
    expect(idA).toBe(idB);
    expect(await intentsForClaim(claimId)).toHaveLength(1);
  });

  it('rejects intent creation without auth (401)', async () => {
    const res = await postIntent(undefined, randomUUID());
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for another user’s claim', async () => {
    const cookieA = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookieA, slotId);
    const cookieB = await loginAs(randomWallet());
    const res = await postIntent(cookieB, claimId);
    expect(res.statusCode).toBe(404);
  });

  it('rejects intent creation on an expired claim with 409 CLAIM_NOT_PAYABLE', async () => {
    const db = getDb();
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await db.update(claims).set({ status: 'expired' }).where(eq(claims.id, claimId));
    const res = await postIntent(cookie, claimId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_PAYABLE');
  });

  it('submits a payment: intent submitted, claim payment_pending', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await postIntent(cookie, claimId);
    const hash = freshHash();
    const res = await postSubmission(cookie, claimId, { txHash: hash });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { intent: Record<string, unknown>; claim: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.intent['status']).toBe('submitted');
    expect(body.data.intent['txHash']).toBe(hash);
    expect(typeof body.data.intent['submittedAt']).toBe('string');
    expect(body.data.claim['status']).toBe('payment_pending');
  });

  it('rejects submission without an intent (409 PAYMENT_INTENT_REQUIRED)', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const res = await postSubmission(cookie, claimId, { txHash: freshHash() });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PAYMENT_INTENT_REQUIRED');
  });

  it('replays the same hash idempotently', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await postIntent(cookie, claimId);
    const hash = freshHash();
    const first = await postSubmission(cookie, claimId, { txHash: hash });
    expect(first.statusCode).toBe(200);
    const second = await postSubmission(cookie, claimId, { txHash: hash });
    expect(second.statusCode).toBe(200);
    const a = first.json() as { data: { intent: { txHash: unknown }; claim: { status: unknown } } };
    const b = second.json() as { data: { intent: { txHash: unknown }; claim: { status: unknown } } };
    expect(b.data.intent.txHash).toBe(a.data.intent.txHash);
    expect(b.data.claim.status).toBe('payment_pending');
  });

  it('rejects the same hash on a different claim (409 PAYMENT_ALREADY_SUBMITTED)', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotA = await makeSlot();
    const slotB = await makeSlot();
    const claimA = await claimAs(cookie, slotA);
    const claimB = await claimAs(cookie, slotB);
    await postIntent(cookie, claimA);
    await postIntent(cookie, claimB);
    const hash = freshHash();
    const first = await postSubmission(cookie, claimA, { txHash: hash });
    expect(first.statusCode).toBe(200);
    const second = await postSubmission(cookie, claimB, { txHash: hash });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('PAYMENT_ALREADY_SUBMITTED');
  });

  it('rejects a different hash on an already-submitted claim (409)', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await postIntent(cookie, claimId);
    const hashA = freshHash();
    const hashB = freshHash();
    await postSubmission(cookie, claimId, { txHash: hashA });
    const res = await postSubmission(cookie, claimId, { txHash: hashB });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PAYMENT_ALREADY_SUBMITTED');
  });

  it('rejects submission on an expired claim with 409 CLAIM_EXPIRED', { timeout: 30_000 }, async () => {
    const db = getDb();
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await postIntent(cookie, claimId);
    await db.update(claims).set({ status: 'expired' }).where(eq(claims.id, claimId));
    const res = await postSubmission(cookie, claimId, { txHash: freshHash() });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_EXPIRED');
  });

  it('rejects submission on a paid claim with 409 CLAIM_ALREADY_PAID', { timeout: 30_000 }, async () => {
    const db = getDb();
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await db.insert(paymentIntents).values({
      claimId,
      expectedAmountNim: 150000n,
      expectedRecipient: validPayout(),
      expectedSender: validPayout(),
      expectedData: `TAKEOVER:v1:${claimId}`,
      status: 'created',
    });
    await db.update(claims).set({ status: 'paid' }).where(eq(claims.id, claimId));
    const res = await postSubmission(cookie, claimId, { txHash: freshHash() });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_ALREADY_PAID');
  });

  it('rejects submission without auth (401) and on foreign claims (404)', { timeout: 30_000 }, async () => {
    const cookieA = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookieA, slotId);
    const anon = await postSubmission(undefined, claimId, { txHash: freshHash() });
    expect(anon.statusCode).toBe(401);
    const cookieB = await loginAs(randomWallet());
    const foreign = await postSubmission(cookieB, claimId, { txHash: freshHash() });
    expect(foreign.statusCode).toBe(404);
  });

  // Explicit timeout: login + slot + claim + intent chain against remote
  // Postgres exceeds the 5s default under full-suite parallel load.
  it('exposes the locked buyer projection (string amount, exact data, no sender)', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const payout = validPayout();
    const slotId = await makeSlot(payout);
    const claimId = await claimAs(cookie, slotId);
    const res = await postIntent(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { intent: Record<string, unknown> } };
    expect(Object.keys(body.data.intent).sort()).toEqual(
      [
        'id',
        'claimId',
        'expectedAmountNim',
        'expectedRecipient',
        'expectedData',
        'status',
        'txHash',
        'submittedAt',
        'createdAt',
      ].sort(),
    );
    expect(body.data.intent['expectedAmountNim']).toBe('150000');
    expect(typeof body.data.intent['expectedAmountNim']).toBe('string');
    expect(body.data.intent['expectedRecipient']).toBe(payout);
    expect(body.data.intent['expectedData']).toBe(`TAKEOVER:v1:${claimId}`);
    expect(body.data.intent).not.toHaveProperty('expected_sender');
    expect(body.data.intent).not.toHaveProperty('expectedSender');
  });
});
