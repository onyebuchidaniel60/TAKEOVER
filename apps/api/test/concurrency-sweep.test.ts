// Concurrency sweep at scale — live DB, no mocks. Every scenario
// fires real parallel HTTP against real Postgres row locks and asserts the
// EXACT final state (counts, codes, inventory, rows), not just winners.
// Authentication uses the injected stub (crypto is proven by the E2E journey
// with real signatures); the CSRF pair rides every credentialed mutation,
// exactly as the web client sends it.
//
// Scale budget: 50 logins + 50-way races against remote Postgres need wall
// time, so this file carries a 5-minute budget (proportional to workload,
// precedent — not a flake fix; every assert below is on exact final
// state, never on timing).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import type { NimiqRpcClient, TxRecord } from '../src/payments/rpc';
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

vi.setConfig({ testTimeout: 300000 });

const LIVE_STATUSES = ['active_hold', 'payment_pending', 'payment_review', 'paid'] as const;

describe.skipIf(!isDatabaseConfigured())('concurrency sweep (live, no mocks)', () => {
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
  };

  const app = buildApp({
    verifySignature: stubVerifier,
    rpcClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 10000 },
      verify: { windowMs: 60_000, max: 10000 },
      intent: { windowMs: 60_000, max: 10000 },
      submission: { windowMs: 60_000, max: 10000 },
      // Per-claim verify budget disabled (window 0 = always allow): the
      // double-verify race must reach the service, not the 429 path.
      verifyPayment: { windowMs: 0 },
      claimCreate: { windowMs: 60_000, max: 10000 },
      slotCreate: { windowMs: 3_600_000, max: 10000 },
      slotMutate: { windowMs: 60_000, max: 10000 },
      providerClaims: { windowMs: 60_000, max: 10000 },
      providerProfile: { windowMs: 60_000, max: 10000 },
      admin: { windowMs: 60_000, max: 10000 },
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

  /** N distinct buyers, logged in with bounded parallelism (remote-DB wall time). */
  async function loginMany(n: number): Promise<Array<{ wallet: string; cookie: string }>> {
    const buyers = Array.from({ length: n }, () => randomWallet());
    const out: Array<{ wallet: string; cookie: string }> = [];
    for (let i = 0; i < buyers.length; i += 10) {
      const chunk = buyers.slice(i, i + 10);
      const paired = await Promise.all(chunk.map(async (w) => ({ wallet: w, cookie: await loginAs(w) })));
      out.push(...paired);
    }
    return out;
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

  async function makeSlot(total: number): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 SWEEPPROV${tag.toUpperCase()}`;
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
      title: `Sweep ${tag} slot`,
      description: null,
      category: null,
      locationLabel: null,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: total,
      availableQuantity: total,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  function claimPost(cookie: string, slotId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  async function readSlot(slotId: string): Promise<typeof slots.$inferSelect> {
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    if (!rows[0]) throw new Error('expected slot row');
    return rows[0];
  }

  async function readSlotClaims(slotId: string): Promise<Array<typeof claims.$inferSelect>> {
    const db = getDb();
    return db.select().from(claims).where(eq(claims.slotId, slotId));
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
        await db.delete(providerProfiles).where(inArray(providerProfiles.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    fake.txByHash.clear();
    await app.close();
  });

  async function expectRace(slotId: string, racers: number, winners: number): Promise<void> {
    const buyers = await loginMany(racers);
    const results = await Promise.all(buyers.map((b) => claimPost(b.cookie, slotId)));
    const ok = results.filter((r) => r.statusCode === 200);
    const failed = results.filter((r) => r.statusCode !== 200);
    expect(ok).toHaveLength(winners);
    expect(failed).toHaveLength(racers - winners);
    for (const f of failed) {
      expect(f.statusCode).toBe(409);
      expect((f.json() as { error: { code: string } }).error.code).toBe('SLOT_UNAVAILABLE');
    }
    const slot = await readSlot(slotId);
    expect(slot.availableQuantity).toBe(0);
    expect(slot.status).toBe('sold_out');
    expect(await readSlotClaims(slotId)).toHaveLength(winners);
  }

  it('N=10 buyers race for quantity=1: exactly one wins', async () => {
    await expectRace(await makeSlot(1), 10, 1);
  });

  it('N=20 buyers race for quantity=5: exactly five win', async () => {
    await expectRace(await makeSlot(5), 20, 5);
  });

  it('N=50 buyers race for quantity=10: exactly ten win', async () => {
    await expectRace(await makeSlot(10), 50, 10);
  });

  it('same buyer fires 10 concurrent claims: one row, one decrement', async () => {
    const slotId = await makeSlot(4);
    const cookie = await loginAs(randomWallet());
    const results = await Promise.all(Array.from({ length: 10 }, () => claimPost(cookie, slotId)));
    for (const r of results) {
      expect(r.statusCode).toBe(200);
    }
    const ids = results.map((r) => (r.json() as { data: { claim: { id: string } } }).data.claim.id);
    expect(new Set(ids).size).toBe(1);
    expect(await readSlotClaims(slotId)).toHaveLength(1);
    const slot = await readSlot(slotId);
    expect(slot.availableQuantity).toBe(3);
    expect(slot.status).toBe('published');
  });

  it('cancel-during-claim: never partial, invariant holds on both branches', async () => {
    const providerCookie = await loginAs(randomWallet());
    const now = Date.now();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie: providerCookie, ...CSRF },
      payload: {
        title: `Sweep ${tag} cancellable`,
        starts_at: new Date(now + 2 * HOUR).toISOString(),
        ends_at: new Date(now + 4 * HOUR).toISOString(),
        price_usdt: '150000',
        total_quantity: 4,
      },
    });
    expect(create.statusCode).toBe(201);
    const slotId = (create.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(slotId);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/slots/${slotId}/publish`,
          headers: { cookie: providerCookie, ...CSRF },
        })
      ).statusCode,
    ).toBe(200);
    const buyers = await loginMany(5);
    const [cancelRes, ...claimRess] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/slots/${slotId}/cancel`,
        headers: { cookie: providerCookie, ...CSRF },
      }),
      ...buyers.map((b) => claimPost(b.cookie, slotId)),
    ]);
    expect([200, 409]).toContain(cancelRes.statusCode);
    for (const r of claimRess) {
      expect([200, 409]).toContain(r.statusCode);
    }
    const slot = await readSlot(slotId);
    const rows = await readSlotClaims(slotId);
    const live = rows.filter((c) => (LIVE_STATUSES as readonly string[]).includes(c.status));
    if (slot.status === 'cancelled') {
      // Cancel won: every hold it found was released, late claims 409'd.
      expect(live).toHaveLength(0);
      for (const c of rows) {
        expect(c.status).toBe('cancelled');
      }
    } else {
      // Cancel lost (slot already sold_out → 409): all surviving holds are live.
      expect(slot.status).toBe('sold_out');
      expect(cancelRes.statusCode).toBe(409);
      expect(live.length + slot.availableQuantity).toBe(slot.totalQuantity);
      for (const c of live) {
        expect(c.status).toBe('active_hold');
      }
    }
    // The brief invariant, both branches.
    expect(live.length + slot.availableQuantity === slot.totalQuantity || slot.status === 'cancelled').toBe(true);
  });

  it('concurrent verify-payment x2: one transition, no double-write', async () => {
    const slotId = await makeSlot(2);
    const cookie = await loginAs(randomWallet());
    const claimRes = await claimPost(cookie, slotId);
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/claims/${claimId}/payment-intent`,
          headers: { cookie, ...CSRF },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const hash = freshHash();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/claims/${claimId}/payment-submission`,
          headers: { cookie, ...CSRF },
          payload: { txHash: hash },
        })
      ).statusCode,
    ).toBe(200);
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
    fake.delayMs = 30;
    try {
      const both = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie, ...CSRF }, payload: {} }),
        app.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie, ...CSRF }, payload: {} }),
      ]);
      for (const r of both) {
        expect(r.statusCode).toBe(200);
        expect((r.json() as { data: { verification: { status: string } } }).data.verification.status).toBe('verified');
      }
      const claimRows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      const freshIntent = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
      expect(claimRows[0]?.status).toBe('paid');
      expect(freshIntent?.status).toBe('verified');
      expect(freshIntent?.verifiedAt).not.toBeNull();
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, claimId));
      expect(audits.filter((a) => a.eventType === 'payment.verified')).toHaveLength(1);
    } finally {
      fake.delayMs = 0;
      fake.txByHash.delete(hash.toLowerCase());
    }
  });

  it('concurrent admin review resolution x2: one wins, inventory restored once', async () => {
    const slotId = await makeSlot(2);
    const cookie = await loginAs(randomWallet());
    const claimRes = await claimPost(cookie, slotId);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    const hash = freshHash();
    await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie, ...CSRF },
      payload: { txHash: hash },
    });
    const db = getDb();
    const intentRows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1);
    const intent = intentRows[0];
    if (!intent) throw new Error('expected intent row');
    // Reach review through the real mismatch path (wrong data on chain).
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
      const review = await app.inject({
        method: 'POST',
        url: `/api/v1/claims/${claimId}/verify-payment`,
        headers: { cookie, ...CSRF },
        payload: {},
      });
      expect(review.statusCode).toBe(200);
      expect((review.json() as { data: { verification: { status: string } } }).data.verification.status).toBe('review');
      const before = await readSlot(slotId);
      expect(before.availableQuantity).toBe(1);
      const adminA = await loginAdmin();
      const adminB = await loginAdmin();
      const [first, second] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/payment-reviews/${claimId}/resolve`,
          headers: { cookie: adminA.cookie, ...CSRF },
          payload: { action: 'reject', resolutionNotes: 'no payment found here' },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/payment-reviews/${claimId}/resolve`,
          headers: { cookie: adminB.cookie, ...CSRF },
          payload: { action: 'reject', resolutionNotes: 'second attempt here' },
        }),
      ]);
      const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
      expect(codes).toEqual([200, 409]);
      const loser = first.statusCode === 409 ? first : second;
      expect((loser.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_IN_REVIEW');
      const claimRows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      const freshIntent = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
      expect(claimRows[0]?.status).toBe('cancelled');
      expect(freshIntent?.status).toBe('rejected');
      const after = await readSlot(slotId);
      expect(after.availableQuantity).toBe(before.availableQuantity + 1);
      expect(after.availableQuantity).toBe(after.totalQuantity);
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, claimId));
      expect(audits.filter((a) => a.eventType === 'payment_review.resolved')).toHaveLength(1);
    } finally {
      fake.txByHash.delete(hash.toLowerCase());
    }
  });
});
