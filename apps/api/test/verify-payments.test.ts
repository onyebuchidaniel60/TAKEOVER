// Phase 8 integration tests — live DB, fake RPC client. Auth goes through the
// real challenge/verify flow with an injected signature stub. The chain reader
// is a test-double implementing NimiqRpcClient; the live-network shape is
// pinned separately by nimiq-rpc-live.test.ts. Fresh claims per test keep the
// per-claim verify limiter isolated.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { RpcUnavailableError, type NimiqRpcClient, type TxRecord } from '../src/payments/rpc';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, paymentIntents, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('verify-payment against the chain (live DB, fake RPC)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    calls: string[];
    txByHash: Map<string, TxRecord>;
    failWithUnavailable: boolean;
  } = { calls: [], txByHash: new Map(), failWithUnavailable: false };

  const rpcClient: NimiqRpcClient = {
    async getTransactionByHash(hash: string): Promise<TxRecord | null> {
      fake.calls.push(hash);
      if (fake.failWithUnavailable) {
        throw new RpcUnavailableError('boom');
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
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      // Phase 12 budgets disabled here (proven separately in security.test.ts).
      claimCreate: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];

  // Phase 12 completion (F4): the CSRF guard requires an allowlisted Origin
  // and the client header on every credentialed mutation. The test allowlist
  // is the dev default (CORS_ORIGINS unset here).
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

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

  function matchingTx(overrides: Partial<TxRecord> & { hash: string }): TxRecord {
    return {
      sender: '',
      recipient: '',
      value: '150000',
      data: '',
      confirmations: 5,
      blockNumber: 1_999_990,
      ...overrides,
    };
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
    const providerWallet = `NQ00 P8PROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `P8 ${tag} slot`,
      description: `P8 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: overrides.startsAt ?? new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: 150000n,
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

  /** Full submission setup: claim → intent → submit. Returns ids + buyer wallet + payout. */
  async function submittedClaim(): Promise<{
    cookie: string;
    claimId: string;
    buyerWallet: string;
    payout: string;
    hash: string;
  }> {
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const payout = validPayout();
    const slotId = await makeSlot(payout);
    const claimId = await claimAs(cookie, slotId);
    const intent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(intent.statusCode).toBe(200);
    const hash = freshHash();
    const submission = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie, ...CSRF },
      payload: { txHash: hash },
    });
    expect(submission.statusCode).toBe(200);
    return { cookie, claimId, buyerWallet, payout, hash };
  }

  function programTx(tx: TxRecord): void {
    fake.txByHash.set(tx.hash.toLowerCase(), tx);
  }

  function resetFake(): void {
    fake.calls = [];
    fake.txByHash.clear();
    fake.failWithUnavailable = false;
  }

  async function postVerify(
    cookie: string | undefined,
    claimId: string,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-payment`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: {},
    });
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
        // Phase 10 audit rows reference their actor: remove them first.
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('verifies a matching confirmed transaction: intent verified, claim paid', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({ hash, sender: buyerWallet, recipient: payout, data: `TAKEOVER:v1:${claimId}` }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; intent: Record<string, unknown>; verification: Record<string, unknown> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.claim['status']).toBe('paid');
    expect(body.data.intent['status']).toBe('verified');
    expect(body.data.intent['txHash']).toBe(hash);
    expect(body.data.verification).toMatchObject({ status: 'verified', confirmations: 5 });
    expect(fake.calls).toContain(hash);
  });

  it('stays payment_pending when the transaction is not on chain', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId } = await submittedClaim();
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; intent: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('payment_pending');
    expect(body.data.intent['status']).toBe('submitted');
    expect(body.data.verification['status']).toBe('pending');
  });

  it('reviews a sender mismatch', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({ hash, sender: randomWallet(), recipient: payout, data: `TAKEOVER:v1:${claimId}` }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; intent: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('payment_review');
    expect(body.data.intent['status']).toBe('review');
    expect(body.data.verification).toMatchObject({ status: 'review', reason: 'sender_mismatch' });
  });

  it('reviews a recipient mismatch', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, hash } = await submittedClaim();
    programTx(
      matchingTx({
        hash,
        sender: buyerWallet,
        recipient: validPayout(),
        data: `TAKEOVER:v1:${claimId}`,
      }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { verification: Record<string, unknown> } };
    expect(body.data.verification).toMatchObject({ status: 'review', reason: 'recipient_mismatch' });
  });

  it('reviews an amount mismatch', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({
        hash,
        sender: buyerWallet,
        recipient: payout,
        value: '149999',
        data: `TAKEOVER:v1:${claimId}`,
      }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { verification: Record<string, unknown> } };
    expect(body.data.verification).toMatchObject({ status: 'review', reason: 'amount_mismatch' });
  });

  it('reviews a data mismatch', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({ hash, sender: buyerWallet, recipient: payout, data: 'TAKEOVER:v1:wrong' }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { verification: Record<string, unknown> } };
    expect(body.data.verification).toMatchObject({ status: 'review', reason: 'data_mismatch' });
  });

  it('stays payment_pending on insufficient confirmations', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({
        hash,
        sender: buyerWallet,
        recipient: payout,
        data: `TAKEOVER:v1:${claimId}`,
        confirmations: 2,
      }),
    );
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('payment_pending');
    expect(body.data.verification).toMatchObject({ status: 'pending', confirmations: 2 });
  });

  it('is a no-op on a paid claim without touching the chain', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({ hash, sender: buyerWallet, recipient: payout, data: `TAKEOVER:v1:${claimId}` }),
    );
    const first = await postVerify(cookie, claimId);
    expect(first.statusCode).toBe(200);
    fake.calls = [];
    const second = await postVerify(cookie, claimId);
    expect(second.statusCode).toBe(200);
    const body = second.json() as {
      data: { claim: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('paid');
    expect(body.data.verification['status']).toBe('verified');
    expect(fake.calls).toHaveLength(0);
  });

  it('is a no-op on a payment_review claim without touching the chain', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId, payout, hash } = await submittedClaim();
    programTx(
      matchingTx({ hash, sender: randomWallet(), recipient: payout, data: `TAKEOVER:v1:${claimId}` }),
    );
    const first = await postVerify(cookie, claimId);
    expect(first.statusCode).toBe(200);
    fake.calls = [];
    const second = await postVerify(cookie, claimId);
    expect(second.statusCode).toBe(200);
    const body = second.json() as {
      data: { claim: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('payment_review');
    expect(body.data.verification['status']).toBe('review');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects verify on a non-pending claim with 409 CLAIM_NOT_IN_PAYMENT_PENDING', { timeout: 30_000 }, async () => {
    resetFake();
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_IN_PAYMENT_PENDING');
  });

  it('returns 404 on another user’s claim and 401 without auth', { timeout: 30_000 }, async () => {
    resetFake();
    const { claimId } = await submittedClaim();
    const stranger = await loginAs(randomWallet());
    const foreign = await postVerify(stranger, claimId);
    expect(foreign.statusCode).toBe(404);
    const anon = await postVerify(undefined, claimId);
    expect(anon.statusCode).toBe(401);
  });

  it('maps RPC failure to 503 RPC_UNAVAILABLE with state unchanged', { timeout: 30_000 }, async () => {
    resetFake();
    fake.failWithUnavailable = true;
    const { cookie, claimId } = await submittedClaim();
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RPC_UNAVAILABLE');
    const db = getDb();
    const intents = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId));
    const claimsRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(intents[0]?.status).toBe('submitted');
    expect(claimsRows[0]?.status).toBe('payment_pending');
  });

  it('rate limits a second verify within 5 seconds with 429 and Retry-After', { timeout: 30_000 }, async () => {
    resetFake();
    const { cookie, claimId } = await submittedClaim();
    const first = await postVerify(cookie, claimId);
    expect(first.statusCode).toBe(200);
    const second = await postVerify(cookie, claimId);
    expect(second.statusCode).toBe(429);
    expect((second.json() as { error: { code: string } }).error.code).toBe('VERIFY_RATE_LIMITED');
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('ages an old pending submission to review on timeout', { timeout: 30_000 }, async () => {
    resetFake();
    const db = getDb();
    const { cookie, claimId } = await submittedClaim();
    await db
      .update(paymentIntents)
      .set({ submittedAt: new Date(Date.now() - 2000 * 1000) })
      .where(eq(paymentIntents.claimId, claimId));
    const res = await postVerify(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claim: Record<string, unknown>; intent: Record<string, unknown>; verification: Record<string, unknown> };
    };
    expect(body.data.claim['status']).toBe('payment_review');
    expect(body.data.intent['status']).toBe('review');
    expect(body.data.verification).toMatchObject({ status: 'review', reason: 'timeout' });
  });
});
