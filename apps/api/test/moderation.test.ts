// Phase 10 integration tests — live DB. Auth via the real challenge/verify
// flow with an injected signature stub; admin promotion via the real
// ADMIN_WALLET_ADDRESSES env (set only around the admin login, then cleared).
// Chain reads use a fake RPC client. Fresh fixtures per test keep the
// per-user report limiter and per-claim verify limiter isolated.
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
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
  reports,
  sessions,
  slots,
  users,
} from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('moderation and audit (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: { txByHash: Map<string, TxRecord> } = { txByHash: new Map() };
  const rpcClient: NimiqRpcClient = {
    async getTransactionByHash(hash: string): Promise<TxRecord | null> {
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
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      // Phase 12 budgets disabled here (proven separately in security.test.ts).
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
      admin: { windowMs: 60_000, max: 1000 },
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

  async function loginAdmin(): Promise<{ cookie: string; wallet: string; userId: string }> {
    const wallet = randomWallet();
    process.env.ADMIN_WALLET_ADDRESSES = wallet;
    try {
      const cookie = await loginAs(wallet);
      const userId = await userIdFor(wallet);
      const db = getDb();
      const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
      expect(rows[0]?.role).toBe('admin');
      return { cookie, wallet, userId };
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

  async function makeSlot(
    payout = validPayout(),
    overrides: { total?: number; available?: number; status?: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired' } = {},
  ): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 P1PROV${tag.toUpperCase()}`;
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
      title: `P10 ${tag} slot`,
      description: `P10 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: 150000n,
      totalQuantity: overrides.total ?? 4,
      availableQuantity: overrides.available ?? overrides.total ?? 4,
      payoutWallet: payout,
      status: overrides.status ?? 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function claimAs(cookie: string, slotId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { claim: { id: string } } }).data.claim.id;
  }

  async function intentAndSubmit(cookie: string, claimId: string, hash?: string): Promise<string> {
    const intent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      headers: { cookie },
      payload: {},
    });
    expect(intent.statusCode).toBe(200);
    const txHash = hash ?? freshHash();
    const submission = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie },
      payload: { txHash },
    });
    expect(submission.statusCode).toBe(200);
    return txHash;
  }

  async function auditRows(entityId: string, eventType: string) {
    const db = getDb();
    return db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.eventType, eventType)));
  }

  afterAll(async () => {
    const db = getDb();
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.walletAddress, wallets));
    const userIds = found.map((u) => u.id);
    if (userIds.length > 0) {
      await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
    }
    if (slotIds.length > 0) {
      const claimRows = await db.select({ id: claims.id }).from(claims).where(inArray(claims.slotId, slotIds));
      const claimIds = claimRows.map((c) => c.id);
      if (claimIds.length > 0) {
        await db.delete(paymentIntents).where(inArray(paymentIntents.claimId, claimIds));
      }
      await db.delete(claims).where(inArray(claims.slotId, slotIds));
    }
    if (userIds.length > 0) {
      // Reports reference both users and slots: remove them before slots/users.
      await db.delete(reports).where(inArray(reports.reporterId, userIds));
    }
    if (slotIds.length > 0) {
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    if (wallets.length > 0) {
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  // -- reports --------------------------------------------------------------

  it('creates an open report for an authenticated user (201)', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { slotId, reason: 'misleading_listing' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { report: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.report['status']).toBe('open');
    expect(body.data.report['reason']).toBe('misleading_listing');
    const audits = await auditRows(body.data.report['id'] as string, 'report.created');
    expect(audits).toHaveLength(1);
  });

  it('rejects anonymous report creation with 401', { timeout: 30_000 }, async () => {
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      payload: { slotId, reason: 'misleading_listing' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits report creation at 5/hour with 429 REPORT_RATE_LIMITED', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { cookie },
        payload: { slotId, reason: 'prohibited_content', details: `report ${i}` },
      });
      expect(res.statusCode).toBe(201);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { slotId, reason: 'prohibited_content' },
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('REPORT_RATE_LIMITED');
  });

  it('rejects self-reports and target-less bodies with 400', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const ownId = await userIdFor(wallet);
    const selfTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { targetUserId: ownId, reason: 'payment_issue' },
    });
    expect(selfTarget.statusCode).toBe(400);
    const noTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { reason: 'payment_issue' },
    });
    expect(noTarget.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { slotId: randomUUID(), reason: 'payment_issue' },
    });
    expect(missing.statusCode).toBe(404);
    const missingUser = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie },
      payload: { targetUserId: randomUUID(), reason: 'payment_issue' },
    });
    expect(missingUser.statusCode).toBe(404);
  });

  // -- admin reports ---------------------------------------------------------

  it('denies admin reports to anonymous (401) and non-admin (403), allows admin (200)', { timeout: 30_000 }, async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/reports' });
    expect(anon.statusCode).toBe(401);
    const userCookie = await loginAs(randomWallet());
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/reports',
      headers: { cookie: userCookie },
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const admin = await loginAdmin();
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/reports',
      headers: { cookie: admin.cookie },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      data: { reports: unknown[]; total: number; limit: number; offset: number };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(typeof body.data.total).toBe('number');
  });

  it('resolves a report and writes report.resolved', { timeout: 30_000 }, async () => {
    const reporterCookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie: reporterCookie },
      payload: { slotId, reason: 'unauthorized_listing' },
    });
    expect(created.statusCode).toBe(201);
    const reportId = (created.json() as { data: { report: { id: string } } }).data.report.id;
    const admin = await loginAdmin();
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/reports/${reportId}/resolve`,
      headers: { cookie: admin.cookie },
      payload: { action: 'reviewed', resolutionNotes: 'Looked into it, valid listing.' },
    });
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json() as { data: { report: Record<string, unknown> } };
    expect(body.data.report['status']).toBe('reviewed');
    expect(body.data.report['resolved_by_user_id']).toBe(admin.userId);
    const audits = await auditRows(reportId, 'report.resolved');
    expect(audits).toHaveLength(1);
    expect((audits[0]?.metadata as Record<string, unknown>)?.['to']).toBe('reviewed');
  });

  // -- admin slot disable ----------------------------------------------------

  it('disables a slot: cancels holds, reviews pendings, keeps paid, zeroes stock', { timeout: 60_000 }, async () => {
    const payout = validPayout();
    const slotId = await makeSlot(payout, { total: 4, available: 4 });
    const buyerHold = randomWallet();
    const holdCookie = await loginAs(buyerHold);
    const holdId = await claimAs(holdCookie, slotId);
    const buyerPending = randomWallet();
    const pendingCookie = await loginAs(buyerPending);
    const pendingId = await claimAs(pendingCookie, slotId);
    const pendingHash = await intentAndSubmit(pendingCookie, pendingId);
    void pendingHash;
    const buyerPaid = randomWallet();
    const paidCookie = await loginAs(buyerPaid);
    const paidId = await claimAs(paidCookie, slotId);
    const paidHash = await intentAndSubmit(paidCookie, paidId);
    fake.txByHash.set(paidHash.toLowerCase(), {
      hash: paidHash,
      sender: buyerPaid,
      recipient: payout,
      value: '150000',
      data: `TAKEOVER:v1:${paidId}`,
      confirmations: 5,
      blockNumber: 1_999_990,
    });
    const verified = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${paidId}/verify-payment`,
      headers: { cookie: paidCookie },
      payload: {},
    });
    expect(verified.statusCode).toBe(200);

    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/slots/${slotId}/disable`,
      headers: { cookie: admin.cookie },
      payload: { reason: 'Confirmed policy violation on this listing.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { slot: Record<string, unknown>; migratedClaims: string[]; warning: string | null };
    };
    expect(body.data.slot['status']).toBe('cancelled');
    expect(body.data.slot['available_quantity']).toBe(0);
    expect(body.data.migratedClaims).toContain(pendingId);
    expect(typeof body.data.warning).toBe('string');

    const db = getDb();
    const holdRows = await db.select().from(claims).where(eq(claims.id, holdId));
    const pendingRows = await db.select().from(claims).where(eq(claims.id, pendingId));
    const paidRows = await db.select().from(claims).where(eq(claims.id, paidId));
    expect(holdRows[0]?.status).toBe('cancelled');
    expect(pendingRows[0]?.status).toBe('payment_review');
    expect(paidRows[0]?.status).toBe('paid');
    const audits = await auditRows(slotId, 'slot.disabled_by_admin');
    expect(audits).toHaveLength(1);
  });

  it('rejects disabling an already-cancelled slot with 409', { timeout: 30_000 }, async () => {
    const slotId = await makeSlot(validPayout(), { status: 'cancelled' });
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/slots/${slotId}/disable`,
      headers: { cookie: admin.cookie },
      payload: { reason: 'Second attempt at disabling.' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_DISABLEABLE');
  });

  // -- admin user disable ----------------------------------------------------

  it('disables a user: sessions revoked, next request 401 ACCOUNT_DISABLED', { timeout: 30_000 }, async () => {
    const victimWallet = randomWallet();
    const victimCookie = await loginAs(victimWallet);
    const victimId = await userIdFor(victimWallet);
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${victimId}/disable`,
      headers: { cookie: admin.cookie },
      payload: { reason: 'Repeated abuse after warnings.' },
    });
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const userRows = await db.select().from(users).where(eq(users.id, victimId));
    expect(userRows[0]?.status).toBe('disabled');
    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, victimId));
    expect(sessionRows.length).toBeGreaterThan(0);
    for (const s of sessionRows) {
      expect(s.revokedAt).not.toBeNull();
    }
    const next = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: victimCookie },
    });
    expect(next.statusCode).toBe(401);
    expect((next.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
    const audits = await auditRows(victimId, 'user.disabled');
    expect(audits).toHaveLength(1);
  });

  it('rejects self-disable with 409 CANNOT_DISABLE_SELF', { timeout: 30_000 }, async () => {
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${admin.userId}/disable`,
      headers: { cookie: admin.cookie },
      payload: { reason: 'Trying to disable myself here.' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CANNOT_DISABLE_SELF');
  });

  // -- payment reviews -------------------------------------------------------

  it('lists payment reviews with full reconciliation context', { timeout: 30_000 }, async () => {
    const payout = validPayout();
    const slotId = await makeSlot(payout, { total: 2, available: 2 });
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const claimId = await claimAs(cookie, slotId);
    const hash = await intentAndSubmit(cookie, claimId);
    const db = getDb();
    await db.update(claims).set({ status: 'payment_review', updatedAt: new Date() }).where(eq(claims.id, claimId));
    await db.update(paymentIntents).set({ status: 'review', updatedAt: new Date() }).where(eq(paymentIntents.claimId, claimId));
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-reviews',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { reviews: Record<string, Record<string, unknown>>[]; total: number };
    };
    const found = body.data.reviews.find((r) => (r['claim'] as Record<string, unknown>)['id'] === claimId);
    expect(found).toBeDefined();
    const claim = found?.['claim'] as Record<string, unknown>;
    const slot = found?.['slot'] as Record<string, unknown>;
    const intent = found?.['intent'] as Record<string, unknown>;
    expect(claim['buyerWallet']).toBe(buyerWallet);
    expect(claim['buyerWallet']).not.toContain('…');
    expect(slot['price_nim']).toBe('150000');
    expect(slot['payout_wallet']).toBe(payout);
    expect(intent['tx_hash']).toBe(hash);
    expect(intent['expected_data']).toBe(`TAKEOVER:v1:${claimId}`);
    expect(typeof intent['submitted_at']).toBe('string');
  });

  it('rejects a review: claim cancelled, intent rejected, inventory restored', { timeout: 30_000 }, async () => {
    const payout = validPayout();
    const slotId = await makeSlot(payout, { total: 1, available: 1 });
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const claimId = await claimAs(cookie, slotId);
    await intentAndSubmit(cookie, claimId);
    const db = getDb();
    await db.update(claims).set({ status: 'payment_review', updatedAt: new Date() }).where(eq(claims.id, claimId));
    await db.update(paymentIntents).set({ status: 'review', updatedAt: new Date() }).where(eq(paymentIntents.claimId, claimId));
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payment-reviews/${claimId}/resolve`,
      headers: { cookie: admin.cookie },
      payload: { action: 'reject', resolutionNotes: 'No matching on-chain payment found.' },
    });
    expect(res.statusCode).toBe(200);
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    const intentRows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId));
    const slotRows = await db.select().from(slots).where(eq(slots.id, slotId));
    expect(claimRows[0]?.status).toBe('cancelled');
    expect(intentRows[0]?.status).toBe('rejected');
    expect(slotRows[0]?.availableQuantity).toBe(1);
    expect(slotRows[0]?.status).toBe('published');
    const audits = await auditRows(claimId, 'payment_review.resolved');
    expect(audits).toHaveLength(1);
    expect((audits[0]?.metadata as Record<string, unknown>)?.['action']).toBe('reject');
  });

  it('confirms a review as paid without a chain re-check', { timeout: 30_000 }, async () => {
    const slotId = await makeSlot(validPayout(), { total: 2, available: 2 });
    const cookie = await loginAs(randomWallet());
    const claimId = await claimAs(cookie, slotId);
    await intentAndSubmit(cookie, claimId);
    const db = getDb();
    await db.update(claims).set({ status: 'payment_review', updatedAt: new Date() }).where(eq(claims.id, claimId));
    await db.update(paymentIntents).set({ status: 'review', updatedAt: new Date() }).where(eq(paymentIntents.claimId, claimId));
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payment-reviews/${claimId}/resolve`,
      headers: { cookie: admin.cookie },
      payload: { action: 'confirm_paid', resolutionNotes: 'Operator confirmed funds arrived off-band.' },
    });
    expect(res.statusCode).toBe(200);
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    const intentRows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId));
    expect(claimRows[0]?.status).toBe('paid');
    expect(intentRows[0]?.status).toBe('verified');
  });

  it('rejects resolving a non-review claim with 409 CLAIM_NOT_IN_REVIEW', { timeout: 30_000 }, async () => {
    const slotId = await makeSlot();
    const cookie = await loginAs(randomWallet());
    const claimId = await claimAs(cookie, slotId);
    const admin = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payment-reviews/${claimId}/resolve`,
      headers: { cookie: admin.cookie },
      payload: { action: 'reject', resolutionNotes: 'Trying to resolve a live hold.' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_IN_REVIEW');
  });

  // -- retrofitted audit events ----------------------------------------------

  it('writes user.created on first verify only', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(verify.statusCode).toBe(200);
    const userId = (verify.json() as { data: { user: { id: string } } }).data.user.id;
    expect(await auditRows(userId, 'user.created')).toHaveLength(1);
  });

  it('writes slot.published on publish', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const db = getDb();
    const providerId = await userIdFor(wallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `P10 ${tag} draft`,
      description: 'draft',
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(Date.now() + 2 * HOUR),
      endsAt: new Date(Date.now() + 4 * HOUR),
      priceNim: 150000n,
      totalQuantity: 2,
      availableQuantity: 2,
      payoutWallet: validPayout(),
      status: 'draft',
    });
    slotIds.push(id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/publish`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(await auditRows(id, 'slot.published')).toHaveLength(1);
  });

  it('writes slot.cancelled on provider cancel', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const db = getDb();
    const providerId = await userIdFor(wallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `P10 ${tag} to cancel`,
      description: 'cancel me',
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(Date.now() + 2 * HOUR),
      endsAt: new Date(Date.now() + 4 * HOUR),
      priceNim: 150000n,
      totalQuantity: 2,
      availableQuantity: 2,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${id}/cancel`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const rows = await auditRows(id, 'slot.cancelled');
    expect(rows).toHaveLength(1);
    expect((rows[0]?.metadata as Record<string, unknown>)?.['to']).toBe('cancelled');
  });

  it('writes claim.created on a fresh claim', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const claimId = (res.json() as { data: { claim: { id: string } } }).data.claim.id;
    expect(await auditRows(claimId, 'claim.created')).toHaveLength(1);
  });

  it('writes payment.submitted on a fresh submission', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    await intentAndSubmit(cookie, claimId);
    const rows = await auditRows(claimId, 'payment.submitted');
    expect(rows).toHaveLength(1);
    // Privacy: no tx hash material in metadata.
    expect(JSON.stringify(rows[0]?.metadata ?? {})).not.toContain('txHash');
  });

  it('writes payment.verified when the chain confirms', { timeout: 30_000 }, async () => {
    fake.txByHash.clear();
    const payout = validPayout();
    const slotId = await makeSlot(payout);
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const claimId = await claimAs(cookie, slotId);
    const hash = await intentAndSubmit(cookie, claimId);
    fake.txByHash.set(hash.toLowerCase(), {
      hash,
      sender: buyerWallet,
      recipient: payout,
      value: '150000',
      data: `TAKEOVER:v1:${claimId}`,
      confirmations: 5,
      blockNumber: 1_999_990,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-payment`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(await auditRows(claimId, 'payment.verified')).toHaveLength(1);
  });

  it('writes payment.review on a mismatch', { timeout: 30_000 }, async () => {
    fake.txByHash.clear();
    const payout = validPayout();
    const slotId = await makeSlot(payout);
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const claimId = await claimAs(cookie, slotId);
    const hash = await intentAndSubmit(cookie, claimId);
    fake.txByHash.set(hash.toLowerCase(), {
      hash,
      sender: buyerWallet,
      recipient: validPayout(),
      value: '150000',
      data: `TAKEOVER:v1:${claimId}`,
      confirmations: 5,
      blockNumber: 1_999_990,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-payment`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const rows = await auditRows(claimId, 'payment.review');
    expect(rows).toHaveLength(1);
    expect((rows[0]?.metadata as Record<string, unknown>)?.['to']).toBe('payment_review');
  });

  it('rolls back audit rows when the parent transaction fails', { timeout: 30_000 }, async () => {
    const db = getDb();
    const entityId = randomUUID();
    const actorWallet = randomWallet();
    const actorId = await userIdFor(actorWallet).catch(async () => {
      await db.insert(users).values({ walletAddress: actorWallet }).onConflictDoNothing();
      return userIdFor(actorWallet);
    });
    await expect(
      db.transaction(async (tx) => {
        const { writeAuditEvent } = await import('../src/audit/events');
        await writeAuditEvent(tx, {
          actorUserId: actorId,
          eventType: 'payment.review',
          entityType: 'claim',
          entityId,
          requestId: 'rollback-probe',
          metadata: { from: 'payment_pending', to: 'payment_review' },
        });
        throw new Error('forced parent failure');
      }),
    ).rejects.toThrow('forced parent failure');
    expect(await auditRows(entityId, 'payment.review')).toHaveLength(0);
  });

  it('does not write audit events on idempotent re-returns', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const claimId = (first.json() as { data: { claim: { id: string } } }).data.claim.id;
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(await auditRows(claimId, 'claim.created')).toHaveLength(1);

    const hash = await intentAndSubmit(cookie, claimId);
    const resubmit = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie },
      payload: { txHash: hash },
    });
    expect(resubmit.statusCode).toBe(200);
    expect(await auditRows(claimId, 'payment.submitted')).toHaveLength(1);
  });

  // -- audit list ------------------------------------------------------------

  it('lists audit events with filters for admins only', { timeout: 30_000 }, async () => {
    const admin = await loginAdmin();
    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/audit-events' });
    expect(anon.statusCode).toBe(401);
    const userCookie = await loginAs(randomWallet());
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-events',
      headers: { cookie: userCookie },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-events?limit=5',
      headers: { cookie: admin.cookie },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as {
      data: { events: Record<string, unknown>[]; total: number; limit: number; offset: number };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.limit).toBe(5);
    for (const event of body.data.events) {
      expect(event).toHaveProperty('event_type');
      expect(event).toHaveProperty('entity_type');
      expect(event).toHaveProperty('entity_id');
      expect(event).toHaveProperty('metadata');
      expect(event).toHaveProperty('created_at');
      expect(event).toHaveProperty('request_id');
      // Privacy: truncated actor display, never a full wallet in the payload.
      const actor = event['actor'] as { walletDisplay?: string } | null;
      if (actor) {
        expect(actor.walletDisplay).toContain('…');
      }
    }
    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-events?eventType=user.created&limit=5',
      headers: { cookie: admin.cookie },
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = filtered.json() as { data: { events: Record<string, unknown>[] } };
    for (const event of filteredBody.data.events) {
      expect(event['event_type']).toBe('user.created');
    }
  });
});
