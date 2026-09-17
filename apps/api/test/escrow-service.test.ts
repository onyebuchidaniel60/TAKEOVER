// Phase 14d-2: USDT escrow deposit integration (live DB, mocked Polygon client).
// Auth goes through the real challenge/verify flow with an injected signature
// stub. The Polygon client is a test-double implementing EscrowContractClient;
// ABI wire shape is pinned separately by escrow-deposit.test.ts (no network).
// Fresh claims per test keep the per-claim verify limiter isolated; the main
// app disables it (windowMs 0, Phase 13 sweep precedent) so concurrency races
// reach the service, while the 429 path is proven on a separate default-
// limiter app in the rate-limit test.
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { EscrowContractUnavailableError } from '../src/escrow/polygon/client';
import type {
  DepositedEvent,
  EscrowContractClient,
} from '../../../packages/shared/src/escrow/contract';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import {
  auditEvents,
  authChallenges,
  claims,
  escrows,
  sessions,
  slots,
  users,
} from '../../../db/schema';

const TEST_CONTRACT = '0x3333333333333333333333333333333333333333';
process.env.USDT_ESCROW_CONTRACT_ADDRESS = TEST_CONTRACT;
// Phase 14e P1 (D7 variant B): intent serves the token address for approve().
const TEST_TOKEN = '0x4444444444444444444444444444444444444444';
process.env.USDT_TOKEN_ADDRESS = TEST_TOKEN;

describe.skipIf(!isDatabaseConfigured())('USDT escrow deposit (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    calls: string[];
    events: Map<string, DepositedEvent>;
    failUnavailable: boolean;
  } = { calls: [], events: new Map(), failUnavailable: false };

  const escrowClient: EscrowContractClient = {
    async getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
      fake.calls.push(escrowId);
      if (fake.failUnavailable) {
        throw new EscrowContractUnavailableError('boom');
      }
      return fake.events.get(escrowId.toLowerCase()) ?? null;
    },
    async getDisputeEvent() {
      return null;
    },
    async getTransactionReceipt() {
      return null;
    },
    async release() {
      throw new Error('Phase 14d-3');
    },
    async refund() {
      throw new Error('Phase 14d-3');
    },
  };

  const app = buildApp({
    verifySignature: stubVerifier,
    escrowClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      escrowIntent: { windowMs: 60_000, max: 1000 },
      escrowSubmission: { windowMs: 60_000, max: 1000 },
      verifyDeposit: { windowMs: 0 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const HOUR = 3_600_000;
  const SLOT_PRICE = 1500000n;

  function freshTxHash(): string {
    return `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
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

  async function makeSlot(payout = validPayout()): Promise<string> {
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
      title: `USDT ${tag} slot`,
      description: `USDT ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: SLOT_PRICE,
      totalQuantity: 4,
      availableQuantity: 4,
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

  async function intentAs(cookie: string, claimId: string, token = 'USDT_POLYGON'): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie, ...CSRF },
      payload: { token },
    });
  }

  async function submitAs(cookie: string, claimId: string, transactionHash: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-submission`,
      headers: { cookie, ...CSRF },
      payload: { transactionHash },
    });
  }

  async function verifyAs(cookie: string | undefined, claimId: string, target = app): Promise<InjectResponse> {
    return target.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: {},
    });
  }

  /** Full setup through submission. Returns ids + wallets + on-chain escrow id. */
  async function submittedSetup(): Promise<{
    cookie: string;
    claimId: string;
    buyerWallet: string;
    onChainEscrowId: string;
    txHash: string;
  }> {
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const intent = await intentAs(cookie, claimId);
    expect(intent.statusCode).toBe(200);
    const body = intent.json() as {
      data: { depositInstruction: { onChainEscrowId: string } };
    };
    const onChainEscrowId = body.data.depositInstruction.onChainEscrowId;
    const txHash = freshTxHash();
    const submission = await submitAs(cookie, claimId, txHash);
    expect(submission.statusCode).toBe(200);
    return { cookie, claimId, buyerWallet, onChainEscrowId, txHash };
  }

  function programDeposit(onChainEscrowId: string, overrides: Partial<DepositedEvent> & { buyer: string; amount: bigint }): void {
    fake.events.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: overrides.buyer,
      amountBaseUnits: overrides.amount,
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      blockNumber: 99,
    });
  }

  function resetFake(): void {
    fake.calls = [];
    fake.events.clear();
    fake.failUnavailable = false;
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
        const escrowRows = await db.select({ id: escrows.id }).from(escrows).where(inArray(escrows.claimId, claimIds));
        const escrowIds = escrowRows.map((e) => e.id);
        if (escrowIds.length > 0) {
          await db.delete(auditEvents).where(
            inArray(
              auditEvents.entityId,
              [...claimIds, ...escrowIds],
            ),
          );
        }
        await db.delete(escrows).where(inArray(escrows.claimId, claimIds));
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
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('intent → submission → verify: claim escrow_funded, escrow funded with deadlines', async () => {
    resetFake();
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const intent = await intentAs(cookie, claimId);
    expect(intent.statusCode).toBe(200);
    const intentBody = intent.json() as {
      data: {
        escrow: { id: string; status: string; amount_base_units: string };
        depositInstruction: {
          contractAddress: string;
          tokenAddress: string;
          usdtAmount: string;
          onChainEscrowId: string;
          approveTo: string;
          approveAmount: string;
          buyerWallet: string;
        };
      };
    };
    expect(intentBody.data.escrow.status).toBe('created');
    expect(intentBody.data.escrow.amount_base_units).toBe(SLOT_PRICE.toString());
    expect(intentBody.data.depositInstruction.contractAddress).toBe(TEST_CONTRACT);
    expect(intentBody.data.depositInstruction.tokenAddress).toBe(TEST_TOKEN);
    expect(intentBody.data.depositInstruction.approveTo).toBe(TEST_CONTRACT);
    expect(intentBody.data.depositInstruction.usdtAmount).toBe(SLOT_PRICE.toString());
    expect(intentBody.data.depositInstruction.approveAmount).toBe(
      intentBody.data.depositInstruction.usdtAmount,
    );
    expect(intentBody.data.depositInstruction.onChainEscrowId).toMatch(/^0x[0-9a-f]{64}$/);
    const onChainEscrowId = intentBody.data.depositInstruction.onChainEscrowId;
    const txHash = freshTxHash();
    const submission = await submitAs(cookie, claimId, txHash);
    expect(submission.statusCode).toBe(200);
    // Model B: the depositor is an arbitrary EVM address the backend never
    // knew — verification keys on escrowId + exact amount only.
    programDeposit(onChainEscrowId, {
      buyer: '0x9999999999999999999999999999999999999999',
      amount: SLOT_PRICE,
    });
    const verify = await verifyAs(cookie, claimId);
    expect(verify.statusCode).toBe(200);
    const verifyBody = verify.json() as {
      data: {
        status: string;
        escrow: { status: string; deposit_tx_hash: string; funded_at: string; delivery_deadline: string };
        claim: { status: string };
      };
    };
    expect(verifyBody.data.status).toBe('funded');
    expect(verifyBody.data.claim.status).toBe('escrow_funded');
    expect(verifyBody.data.escrow.status).toBe('funded');
    expect(verifyBody.data.escrow.deposit_tx_hash).toBe(txHash);
    expect(typeof verifyBody.data.escrow.funded_at).toBe('string');
    expect(typeof verifyBody.data.escrow.delivery_deadline).toBe('string');
    const fundedAt = new Date(verifyBody.data.escrow.funded_at).getTime();
    const deadline = new Date(verifyBody.data.escrow.delivery_deadline).getTime();
    expect(deadline - fundedAt).toBe(86400 * 1000);
    // The clock stays in place on funding as historical record.
    const db = getDb();
    const fundedClaim = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(fundedClaim[0]?.depositSubmittedAt).toBeInstanceOf(Date);
  });

  it('second intent on the same claim returns the same escrow id', async () => {
    resetFake();
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const first = await intentAs(cookie, claimId);
    expect(first.statusCode).toBe(200);
    const second = await intentAs(cookie, claimId);
    expect(second.statusCode).toBe(200);
    const a = (first.json() as { data: { escrow: { id: string } } }).data.escrow.id;
    const b = (second.json() as { data: { escrow: { id: string } } }).data.escrow.id;
    expect(b).toBe(a);
  });

  it('second verify after funded is a 200 no-op with zero extra client calls', async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, onChainEscrowId } = await submittedSetup();
    programDeposit(onChainEscrowId, { buyer: buyerWallet, amount: SLOT_PRICE });
    const first = await verifyAs(cookie, claimId);
    expect(first.statusCode).toBe(200);
    fake.calls = [];
    const second = await verifyAs(cookie, claimId);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { status: string } }).data.status).toBe('funded');
    expect(fake.calls).toHaveLength(0);
  });

  it('wrong amount → 200 mismatch, claim stays deposit_submitted, no state change', async () => {
    resetFake();
    const { cookie, claimId, buyerWallet, onChainEscrowId } = await submittedSetup();
    programDeposit(onChainEscrowId, { buyer: buyerWallet, amount: SLOT_PRICE - 1n });
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; reason: string } };
    expect(body.data.status).toBe('mismatch');
    expect(body.data.reason).toBe('amount');
    const db = getDb();
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(claimRows[0]?.status).toBe('deposit_submitted');
    expect(escrowRows[0]?.status).toBe('created');
    expect(escrowRows[0]?.fundedAt).toBeNull();
  });

  it('expired window + pending → payment_review, clock cleared, inventory NOT released', async () => {
    resetFake();
    const db = getDb();
    const { cookie, claimId, txHash } = await submittedSetup();
    // Clock is set on entry to deposit_submitted.
    const entered = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(entered[0]?.status).toBe('deposit_submitted');
    expect(entered[0]?.depositSubmittedAt).toBeInstanceOf(Date);
    const clockAtEntry = entered[0]?.depositSubmittedAt?.getTime() as number;
    // An unrelated write (idempotent same-hash re-submission) does not move it.
    const again = await submitAs(cookie, claimId, txHash);
    expect(again.statusCode).toBe(200);
    const reread = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(reread[0]?.depositSubmittedAt?.getTime()).toBe(clockAtEntry);
    const slotId = entered[0]?.slotId;
    const slotBefore = (await db.select().from(slots).where(eq(slots.id, slotId as string)))[0];
    await db
      .update(claims)
      .set({ depositSubmittedAt: new Date(Date.now() - 2000 * 1000) })
      .where(eq(claims.id, claimId));
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('review');
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('payment_review');
    expect(claimRows[0]?.depositSubmittedAt).toBeNull();
    const slotAfter = (await db.select().from(slots).where(eq(slots.id, slotId as string)))[0];
    expect(slotAfter?.availableQuantity).toBe(slotBefore?.availableQuantity);
  });

  it('anonymous → 401 on all four escrow endpoints', async () => {
    resetFake();
    const { claimId } = await submittedSetup();
    const noAuth = await verifyAs(undefined, claimId);
    expect(noAuth.statusCode).toBe(401);
    const anonIntent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      payload: { token: 'USDT_POLYGON' },
    });
    expect(anonIntent.statusCode).toBe(401);
    const anonSubmit = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-submission`,
      payload: { transactionHash: freshTxHash() },
    });
    expect(anonSubmit.statusCode).toBe(401);
    const anonGet = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}/escrow` });
    expect(anonGet.statusCode).toBe(401);
  });

  it('foreign buyer → 404 on all four escrow endpoints', async () => {
    resetFake();
    const { claimId } = await submittedSetup();
    const stranger = await loginAs(randomWallet());
    const foreignIntent = await intentAs(stranger, claimId);
    expect(foreignIntent.statusCode).toBe(404);
    const foreignSubmit = await submitAs(stranger, claimId, freshTxHash());
    expect(foreignSubmit.statusCode).toBe(404);
    const foreignVerify = await verifyAs(stranger, claimId);
    expect(foreignVerify.statusCode).toBe(404);
    const foreignGet = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: stranger },
    });
    expect(foreignGet.statusCode).toBe(404);
  });

  it("token NIM → 409 ESCROW_TOKEN_UNSUPPORTED with no escrow row", async () => {
    resetFake();
    const db = getDb();
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimId = await claimAs(cookie, slotId);
    const res = await intentAs(cookie, claimId, 'NIM');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_TOKEN_UNSUPPORTED');
    const rows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(rows).toHaveLength(0);
  });

  it('RPC failure → 503 ESCROW_CONTRACT_UNAVAILABLE with state unchanged', async () => {
    resetFake();
    fake.failUnavailable = true;
    const db = getDb();
    const { cookie, claimId } = await submittedSetup();
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_CONTRACT_UNAVAILABLE');
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(claimRows[0]?.status).toBe('deposit_submitted');
    expect(escrowRows[0]?.status).toBe('created');
  });

  it('two parallel verifies → one transition, one no-op, single funded row', async () => {
    resetFake();
    const db = getDb();
    const { cookie, claimId, buyerWallet, onChainEscrowId } = await submittedSetup();
    programDeposit(onChainEscrowId, { buyer: buyerWallet, amount: SLOT_PRICE });
    const [a, b] = await Promise.all([verifyAs(cookie, claimId), verifyAs(cookie, claimId)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { data: { status: string } }).data.status).toBe('funded');
    expect((b.json() as { data: { status: string } }).data.status).toBe('funded');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(escrowRows).toHaveLength(1);
    expect(escrowRows[0]?.status).toBe('funded');
    expect(claimRows[0]?.status).toBe('escrow_funded');
  });

  it('different hash while submitted → 409 PAYMENT_ALREADY_SUBMITTED', async () => {
    resetFake();
    const { cookie, claimId } = await submittedSetup();
    const res = await submitAs(cookie, claimId, freshTxHash());
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PAYMENT_ALREADY_SUBMITTED');
  });

  it('GET escrow returns the buyer-scoped escrow view', async () => {
    resetFake();
    const { cookie, claimId } = await submittedSetup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { escrow: { status: string } } };
    expect(body.data.escrow.status).toBe('created');
  });
});

describe.skipIf(!isDatabaseConfigured())('verify-deposit rate limit (live DB, default limiter)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const quietClient: EscrowContractClient = {
    async getDepositEvent() {
      return null;
    },
    async getDisputeEvent() {
      return null;
    },
    async getTransactionReceipt() {
      return null;
    },
    async release() {
      throw new Error('Phase 14d-3');
    },
    async refund() {
      throw new Error('Phase 14d-3');
    },
  };
  const limited = buildApp({
    verifySignature: stubVerifier,
    escrowClient: quietClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      escrowIntent: { windowMs: 60_000, max: 1000 },
      escrowSubmission: { windowMs: 60_000, max: 1000 },
    },
  });
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.push(wallet);
    return wallet;
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
        await db.delete(escrows).where(inArray(escrows.claimId, claimIds));
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
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await limited.close();
  });

  it('over-budget verify-deposit → 429 with Retry-After', async () => {
    const buyerWallet = randomWallet();
    const challenge = await limited.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: buyerWallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const verifyAuth = await limited.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: buyerWallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(verifyAuth.statusCode).toBe(200);
    const setCookie = verifyAuth.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookie = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0] as string;
    const db = getDb();
    const providerWallet = randomWallet();
    await db.insert(users).values({ walletAddress: providerWallet }).onConflictDoNothing();
    const providerRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, providerWallet))
      .limit(1);
    const slotId = randomUUID();
    const now = Date.now();
    await db.insert(slots).values({
      id: slotId,
      providerId: providerRows[0].id,
      title: 'rate limit slot',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: 1500000n,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: buyerWallet,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(slotId);
    const claimed = await limited.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(claimed.statusCode).toBe(200);
    const claimId = (claimed.json() as { data: { claim: { id: string } } }).data.claim.id;
    const buyerRows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, buyerWallet)).limit(1);
    const buyerId = buyerRows[0].id;
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    await db.insert(escrows).values({
      claimId,
      buyerId,
      providerId: providerRows[0].id,
      paymentToken: 'USDT_POLYGON',
      amountBaseUnits: 1500000n,
      status: 'created',
      contractAddress: TEST_CONTRACT,
      onChainEscrowId: `0x${'ab'.repeat(32)}`,
      depositTxHash: `ratelimit${Date.now()}`,
    });
    await db.update(claims).set({ status: 'deposit_submitted', depositSubmittedAt: new Date(), updatedAt: new Date() }).where(eq(claims.id, claimId));
    void claimRows;
    const first = await limited.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const second = await limited.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(second.statusCode).toBe(429);
    expect((second.json() as { error: { code: string } }).error.code).toBe('VERIFY_RATE_LIMITED');
    expect(second.headers['retry-after']).toBeDefined();
  });
});
