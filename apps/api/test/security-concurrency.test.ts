// Phase 12 concurrency attacks beyond Phase 6 — live DB. Each test races two
// state-changing paths with Promise.all and then asserts exactly one clean
// outcome plus DB invariants (no partial writes, no double transitions, no
// lost hashes, no double inventory restoration). Auth uses the injected stub;
// chain reads use a delay-capable fake RPC client.
//
// Method limit, stated plainly: inject requests interleave on one Node event
// loop against real Postgres row locks — this proves serialization and
// fail-closed conditional writes, not multi-process timing. The deeper proof
// for the final-unit race remains the Phase 6 8-way race plus the partial
// unique index (still passing, untouched).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import type { NimiqRpcClient, TxRecord } from '../src/payments/rpc';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, paymentIntents, sessions, slots, users } from '../../../db/schema';

// Remote-Postgres latency: every test in this file gets a 30s budget
// (Phase 10 precedent — sequential live round trips exceed the 5s default).
vi.setConfig({ testTimeout: 30000 });

describe.skipIf(!isDatabaseConfigured())('phase 12 concurrency attacks (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: { txByHash: Map<string, TxRecord>; delayMs: number } = { txByHash: new Map(), delayMs: 0 };

  const rpcClient: NimiqRpcClient = {
    async getTransactionByHash(hash: string): Promise<TxRecord | null> {
      if (fake.delayMs > 0) {
        await new Promise((r) => setTimeout(r, fake.delayMs));
      }
      return fake.txByHash.get(hash.toLowerCase()) ?? null;
    },
    async getBlockNumber(): Promise<number> {
      return 2_000_000;
    },
    async getBalance(): Promise<string> {
      throw new Error('Not implemented in this fake.');
    },
  };

  const app = buildApp({
    verifySignature: stubVerifier,
    rpcClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
      providerProfile: { windowMs: 60_000, max: 1000 },
      admin: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

  // Phase 12 completion (F4): the CSRF guard requires an allowlisted Origin
  // and the client header on every credentialed mutation. The test allowlist
  // is the dev default (CORS_ORIGINS unset here).
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

  function freshHash(): string {
    return randomUUID().replace(/-/g, '');
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
      const db = getDb();
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
      if (!rows[0]) throw new Error('expected admin user row');
      return { cookie, userId: rows[0].id };
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

  async function makeSlot(total: number, available?: number): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 C12PROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerRows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, providerWallet)).limit(1);
    const providerId = providerRows[0]?.id;
    if (!providerId) throw new Error('expected provider row');
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `C12 ${tag} slot`,
      description: null,
      category: null,
      locationLabel: null,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: 150000n,
      totalQuantity: total,
      availableQuantity: available ?? total,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function readSlot(slotId: string): Promise<typeof slots.$inferSelect> {
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    if (!rows[0]) throw new Error('expected slot row');
    return rows[0];
  }

  async function readClaim(claimId: string): Promise<typeof claims.$inferSelect> {
    const db = getDb();
    const rows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!rows[0]) throw new Error('expected claim row');
    return rows[0];
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      const foundClaims = await db.select({ id: claims.id }).from(claims).where(inArray(claims.slotId, slotIds));
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
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    fake.txByHash.clear();
    await app.close();
  });

  it('claim POST during admin slot disable: exactly one wins, no partial state', async () => {
    const slotId = await makeSlot(1);
    const buyerCookie = await loginAs(randomWallet());
    const { cookie: adminCookie } = await loginAdmin();
    const [claimRes, disableRes] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} }),
      app.inject({ method: 'POST', url: `/api/v1/admin/slots/${slotId}/disable`, headers: { cookie: adminCookie, ...CSRF }, payload: { reason: 'concurrency probe' } }),
    ]);
    expect([200, 409]).toContain(claimRes.statusCode);
    expect([200, 409]).toContain(disableRes.statusCode);
    const winners = [claimRes.statusCode, disableRes.statusCode].filter((s) => s === 200);
    expect(winners).toHaveLength(1);
    const db = getDb();
    const slot = await readSlot(slotId);
    if (claimRes.statusCode === 200) {
      expect(disableRes.statusCode).toBe(409);
      expect((disableRes.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_DISABLEABLE');
      expect(slot.status).toBe('sold_out');
      expect(slot.availableQuantity).toBe(0);
      const live = await db
        .select()
        .from(claims)
        .where(eq(claims.slotId, slotId));
      expect(live.filter((c) => c.status === 'active_hold')).toHaveLength(1);
    } else {
      expect(disableRes.statusCode).toBe(200);
      expect((claimRes.json() as { error: { code: string } }).error.code).toBe('SLOT_UNAVAILABLE');
      expect(slot.status).toBe('cancelled');
      expect(slot.availableQuantity).toBe(0);
      const live = await db.select().from(claims).where(eq(claims.slotId, slotId));
      expect(live.filter((c) => ['active_hold', 'payment_pending', 'payment_review'].includes(c.status))).toHaveLength(0);
    }
  }, 30000);

  it('verify-payment during admin slot disable: no double transition, inventory coherent', async () => {
    const slotId = await makeSlot(2);
    const buyerCookie = await loginAs(randomWallet());
    const claimRes = await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const intentRes = await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-intent`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
    expect(intentRes.statusCode).toBe(200);
    const hash = freshHash();
    const submitRes = await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-submission`, headers: { cookie: buyerCookie, ...CSRF }, payload: { txHash: hash } });
    expect(submitRes.statusCode).toBe(200);
    const db = getDb();
    const intentRows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1);
    const intent = intentRows[0];
    if (!intent) throw new Error('expected intent row');
    fake.txByHash.set(hash.toLowerCase(), {
      hash,
      sender: intent.expectedSender,
      recipient: intent.expectedRecipient,
      value: intent.expectedAmountNim.toString(),
      data: intent.expectedData,
      confirmations: 9,
      blockNumber: 1_999_990,
    });
    fake.delayMs = 80;
    try {
      const { cookie: adminCookie } = await loginAdmin();
      const [verifyRes, disableRes] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} }),
        app.inject({ method: 'POST', url: `/api/v1/admin/slots/${slotId}/disable`, headers: { cookie: adminCookie, ...CSRF }, payload: { reason: 'concurrency probe' } }),
      ]);
      expect(verifyRes.statusCode).toBe(200);
      expect(disableRes.statusCode).toBe(200);
      const claim = await readClaim(claimId);
      const freshIntent = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
      const slot = await readSlot(slotId);
      // The disable always lands (paid demand is left untouched by design);
      // the claim is either verified first or moved to review first.
      expect(slot.status).toBe('cancelled');
      expect(slot.availableQuantity).toBe(0);
      const combo = `${claim.status}/${freshIntent?.status}`;
      expect(['paid/verified', 'payment_review/submitted']).toContain(combo);
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, claimId));
      expect(audits.filter((a) => a.eventType === 'payment.verified')).toHaveLength(combo === 'paid/verified' ? 1 : 0);
      expect(slot.availableQuantity).toBeGreaterThanOrEqual(0);
    } finally {
      fake.delayMs = 0;
      fake.txByHash.delete(hash.toLowerCase());
    }
  }, 30000);

  it('verify-payment during admin payment-review resolution: single terminal state', async () => {
    const slotId = await makeSlot(2);
    const buyerCookie = await loginAs(randomWallet());
    const claimRes = await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-intent`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
    const hash = freshHash();
    await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-submission`, headers: { cookie: buyerCookie, ...CSRF }, payload: { txHash: hash } });
    const db = getDb();
    const intentRows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1);
    const intent = intentRows[0];
    if (!intent) throw new Error('expected intent row');
    // Force the claim into review through the real mismatch path (wrong data).
    fake.txByHash.set(hash.toLowerCase(), {
      hash,
      sender: intent.expectedSender,
      recipient: intent.expectedRecipient,
      value: intent.expectedAmountNim.toString(),
      data: 'WRONG-DATA',
      confirmations: 9,
      blockNumber: 1_999_990,
    });
    try {
      const reviewRes = await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
      expect(reviewRes.statusCode).toBe(200);
      expect((reviewRes.json() as { data: { verification: { status: string } } }).data.verification.status).toBe('review');
      const { cookie: adminCookie } = await loginAdmin();
      const [resolveRes, ...verifyRess] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/admin/payment-reviews/${claimId}/resolve`, headers: { cookie: adminCookie, ...CSRF }, payload: { action: 'confirm_paid', resolutionNotes: 'override confirmed here' } }),
        app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} }),
        app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} }),
      ]);
      expect(resolveRes.statusCode).toBe(200);
      // Race-noop semantics: a verify landing before the resolution sees
      // review; one landing after sees the new terminal state. Both are 200
      // reads with zero writes — never a second transition.
      for (const v of verifyRess) {
        expect(v.statusCode).toBe(200);
        const seen = (v.json() as { data: { verification: { status: string } } }).data.verification.status;
        expect(['review', 'verified']).toContain(seen);
      }
      // A second resolution must fail closed: the claim already left review.
      const again = await app.inject({ method: 'POST', url: `/api/v1/admin/payment-reviews/${claimId}/resolve`, headers: { cookie: adminCookie, ...CSRF }, payload: { action: 'reject', resolutionNotes: 'second attempt here' } });
      expect(again.statusCode).toBe(409);
      expect((again.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_IN_REVIEW');
      const claim = await readClaim(claimId);
      const freshIntent = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
      expect(claim.status).toBe('paid');
      expect(freshIntent?.status).toBe('verified');
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, claimId));
      expect(audits.filter((a) => a.eventType === 'payment_review.resolved')).toHaveLength(1);
    } finally {
      fake.txByHash.delete(hash.toLowerCase());
    }
  }, 30000);

  it('payment submission during hold expiry: no lost hash, no double restore', async () => {
    const slotId = await makeSlot(2);
    const buyerCookie = await loginAs(randomWallet());
    const claimRes = await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} });
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-intent`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} })).statusCode).toBe(200);
    const db = getDb();
    await db.update(claims).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(claims.id, claimId));
    const hash = freshHash();
    const [submitRes, sweepRes] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-submission`, headers: { cookie: buyerCookie, ...CSRF }, payload: { txHash: hash } }),
      app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` }),
    ]);
    expect(sweepRes.statusCode).toBe(200);
    expect([200, 409]).toContain(submitRes.statusCode);
    if (submitRes.statusCode === 200) {
      const claim = await readClaim(claimId);
      const intent = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
      expect(claim.status).toBe('payment_pending');
      expect(intent?.txHash?.toLowerCase()).toBe(hash.toLowerCase());
    } else {
      expect((submitRes.json() as { error: { code: string } }).error.code).toBe('CLAIM_EXPIRED');
      expect((await readClaim(claimId)).status).toBe('expired');
    }
    // Repeated sweeps never restore twice: quantity stays capped at total.
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: await loginAs(randomWallet()), ...CSRF }, payload: {} });
    const slot = await readSlot(slotId);
    expect(slot.availableQuantity).toBeLessThanOrEqual(slot.totalQuantity);
    expect(slot.availableQuantity).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('admin user disable during an in-flight claim: clean 200 or clean 401, never partial', async () => {
    const slotId = await makeSlot(4);
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    const buyerId = await userIdFor(buyerWallet);
    const { cookie: adminCookie } = await loginAdmin();
    const [claimRes, disableRes] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/claims`, headers: { cookie: buyerCookie, ...CSRF }, payload: {} }),
      app.inject({ method: 'POST', url: `/api/v1/admin/users/${buyerId}/disable`, headers: { cookie: adminCookie, ...CSRF }, payload: { reason: 'concurrency probe' } }),
    ]);
    expect(disableRes.statusCode).toBe(200);
    expect([200, 401]).toContain(claimRes.statusCode);
    const db = getDb();
    const slot = await readSlot(slotId);
    const buyerClaims = await db.select().from(claims).where(eq(claims.buyerId, buyerId));
    if (claimRes.statusCode === 200) {
      expect(buyerClaims).toHaveLength(1);
      expect(slot.availableQuantity).toBe(slot.totalQuantity - 1);
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, buyerClaims[0]?.id ?? ''));
      expect(audits.some((a) => a.eventType === 'claim.created')).toBe(true);
    } else {
      expect((claimRes.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
      expect(buyerClaims).toHaveLength(0);
      expect(slot.availableQuantity).toBe(slot.totalQuantity);
    }
    // Either way the account stays disabled afterwards.
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: buyerCookie, ...CSRF } });
    expect(me.statusCode).toBe(401);
    expect((me.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  }, 30000);
});
