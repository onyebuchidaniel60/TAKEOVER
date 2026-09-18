// Phase 14d-3b: buyer dispute + lazy auto-refund integration (live DB,
// mocked Polygon client). Auth via the real challenge/verify flow with an
// injected signature stub. Fresh claims per test keep limiters isolated;
// budgets are disabled on the main app (Phase 13 sweep precedent).
// Time travel (past delivery deadlines / closed windows) is done with
// direct escrow-row updates — the tests own their fixtures.
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import type {
  DepositedEvent,
  DisputedEvent,
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
// Phase 14e P1 (D7 variant B): intent fail-closes without a token address.
process.env.USDT_TOKEN_ADDRESS = '0x4444444444444444444444444444444444444444';

const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe.skipIf(!isDatabaseConfigured())('escrow dispute and auto-refund (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    refundCalls: string[];
    releaseCalls: { escrowId: string; toProvider: string }[];
    receiptCalls: string[];
    refundTxHash: string;
    receipt: { confirmations: number } | null;
  } = { refundCalls: [], releaseCalls: [], receiptCalls: [], refundTxHash: '', receipt: null };

  const depositEvents = new Map<string, DepositedEvent>();
  const disputeEvents = new Map<string, DisputedEvent>();

  const escrowClient: EscrowContractClient = {
    async getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
      return depositEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getDisputeEvent(escrowId: string): Promise<DisputedEvent | null> {
      return disputeEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getTransactionReceipt(txHash: string) {
      fake.receiptCalls.push(txHash);
      return fake.receipt;
    },
    async release(escrowId: string, toProvider: string) {
      fake.releaseCalls.push({ escrowId, toProvider });
      return { txHash: freshTxHash() };
    },
    async refund(escrowId: string) {
      fake.refundCalls.push(escrowId);
      return { txHash: fake.refundTxHash };
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
      markDelivered: { windowMs: 60_000, max: 1000 },
      confirmReceipt: { windowMs: 60_000, max: 1000 },
      dispute: { windowMs: 60_000, max: 1000 },
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

  async function makeSlotFor(providerId: string, payout = validPayout()): Promise<string> {
    const db = getDb();
    const now = Date.now();
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
      priceUsdt: SLOT_PRICE,
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

  /** Full deposit flow through escrow_funded. Returns buyer + provider sessions. */
  async function fundedSetup(): Promise<{
    buyerCookie: string;
    providerCookie: string;
    claimId: string;
    onChainEscrowId: string;
  }> {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    const slotId = await makeSlotFor(providerId);
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    const claimId = await claimAs(buyerCookie, slotId);
    const intent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: { token: 'USDT_POLYGON' },
    });
    expect(intent.statusCode).toBe(200);
    const onChainEscrowId = (
      intent.json() as { data: { depositInstruction: { onChainEscrowId: string } } }
    ).data.depositInstruction.onChainEscrowId;
    const submission = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-submission`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: { transactionHash: freshTxHash() },
    });
    expect(submission.statusCode).toBe(200);
    depositEvents.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: SLOT_PRICE,
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      blockNumber: 99,
    });
    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { data: { status: string } }).data.status).toBe('funded');
    return { buyerCookie, providerCookie, claimId, onChainEscrowId };
  }

  async function deliveredSetup(): Promise<{
    buyerCookie: string;
    providerCookie: string;
    claimId: string;
    onChainEscrowId: string;
  }> {
    const setup = await fundedSetup();
    const delivered = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${setup.claimId}/mark-delivered`,
      headers: { cookie: setup.providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(delivered.statusCode).toBe(200);
    return setup;
  }

  function resetFake(): void {
    fake.refundCalls = [];
    fake.releaseCalls = [];
    fake.receiptCalls = [];
    // Fresh broadcast hash per test: refund_tx_hash is UNIQUE across rows.
    fake.refundTxHash = freshTxHash();
    fake.receipt = null;
    depositEvents.clear();
    disputeEvents.clear();
  }

  async function auditCount(claimId: string, eventType: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, claimId), eq(auditEvents.eventType, eventType)));
    return rows.length;
  }

  async function expireDeliveryDeadline(claimId: string): Promise<void> {
    const db = getDb();
    await db
      .update(escrows)
      .set({ deliveryDeadline: new Date(Date.now() - 1000) })
      .where(eq(escrows.claimId, claimId));
  }

  async function closeDisputeWindow(claimId: string): Promise<void> {
    const db = getDb();
    await db
      .update(escrows)
      .set({ disputeWindowEnds: new Date(Date.now() - 1000) })
      .where(eq(escrows.claimId, claimId));
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
          await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...claimIds, ...escrowIds]));
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

  it('dispute event-absent: pending with call instruction, no state change', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId, onChainEscrowId } = await deliveredSetup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        status: string;
        disputeInstruction: { contractAddress: string; onChainEscrowId: string; callData: string };
        escrow: { status: string };
        claim: { status: string };
      };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.disputeInstruction.contractAddress).toBe(TEST_CONTRACT);
    expect(body.data.disputeInstruction.onChainEscrowId).toBe(onChainEscrowId);
    expect(body.data.disputeInstruction.callData.startsWith('0x')).toBe(true);
    expect(body.data.disputeInstruction.callData.length).toBeGreaterThan(10);
    expect(body.data.escrow.status).toBe('delivered');
    expect(body.data.claim.status).toBe('delivered');
    expect(await auditCount(claimId, 'escrow.disputed')).toBe(0);
  });

  it('dispute event-present: disputed on both rows, one audit, idempotent', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId, onChainEscrowId } = await deliveredSetup();
    disputeEvents.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: null,
      txHash: freshTxHash(),
      blockNumber: 101,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; escrow: { status: string }; claim: { status: string } };
    };
    expect(body.data.status).toBe('disputed');
    expect(body.data.escrow.status).toBe('disputed');
    expect(body.data.claim.status).toBe('disputed');
    expect(await auditCount(claimId, 'escrow.disputed')).toBe(1);
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { data: { status: string } }).data.status).toBe('disputed');
    expect(await auditCount(claimId, 'escrow.disputed')).toBe(1);
  });

  it('dispute window closed → 409 ESCROW_DISPUTE_WINDOW_CLOSED', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId } = await deliveredSetup();
    await closeDisputeWindow(claimId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_DISPUTE_WINDOW_CLOSED');
    expect(await auditCount(claimId, 'escrow.disputed')).toBe(0);
  });

  it('dispute wrong state 409, foreign 404, anonymous 401', { timeout: 60_000 }, async () => {
    resetFake();
    const { claimId } = await deliveredSetup();
    const stranger = await loginAs(randomWallet());
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: stranger, ...CSRF },
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      payload: {},
    });
    expect(anon.statusCode).toBe(401);
    // Wrong state: funded but never delivered.
    const setup = await fundedSetup();
    const early = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${setup.claimId}/dispute`,
      headers: { cookie: setup.buyerCookie, ...CSRF },
      payload: {},
    });
    expect(early.statusCode).toBe(409);
  });

  it('auto-refund happy path: funded+past deadline → refunding → refunded', { timeout: 90_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId } = await fundedSetup();
    await expireDeliveryDeadline(claimId);
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: { escrow: { status: string; refund_tx_hash: string | null }; claim: { status: string } };
    };
    expect(firstBody.data.escrow.status).toBe('refunding');
    expect(firstBody.data.escrow.refund_tx_hash).toBe(fake.refundTxHash);
    expect(firstBody.data.claim.status).toBe('escrow_funded');
    expect(fake.refundCalls).toHaveLength(1);
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(1);
    fake.receipt = { confirmations: 3 };
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: { escrow: { status: string }; claim: { status: string } };
    };
    expect(secondBody.data.escrow.status).toBe('refunded');
    expect(secondBody.data.claim.status).toBe('refunded');
    expect(await auditCount(claimId, 'escrow.refunded')).toBe(1);
  });

  it('auto-refund concurrent reads: exactly one broadcast, one audit, one transition', { timeout: 90_000 }, async () => {
    resetFake();
    const { buyerCookie, providerCookie, claimId } = await fundedSetup();
    await expireDeliveryDeadline(claimId);
    const [asBuyer, asProvider] = await Promise.all([
      app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}/escrow`, headers: { cookie: buyerCookie } }),
      app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}/escrow`, headers: { cookie: providerCookie } }),
    ]);
    expect(asBuyer.statusCode).toBe(200);
    expect(asProvider.statusCode).toBe(200);
    const statuses = [
      (asBuyer.json() as { data: { escrow: { status: string } } }).data.escrow.status,
      (asProvider.json() as { data: { escrow: { status: string } } }).data.escrow.status,
    ].sort();
    // Winner sees refunding; the loser re-reads into the winner's state.
    expect({ statuses, refundCalls: fake.refundCalls }).toEqual({
      statuses: ['refunding', 'refunding'],
      refundCalls: [expect.any(String)],
    });
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(1);
  });

  it('disputed escrow never auto-refunds even past the delivery deadline', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId, onChainEscrowId } = await deliveredSetup();
    disputeEvents.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: null,
      txHash: freshTxHash(),
      blockNumber: 102,
    });
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(opened.statusCode).toBe(200);
    await expireDeliveryDeadline(claimId);
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json() as {
      data: { escrow: { status: string; refund_tx_hash: string | null }; claim: { status: string } };
    };
    expect(body.data.escrow.status).toBe('disputed');
    expect(body.data.claim.status).toBe('disputed');
    expect(body.data.escrow.refund_tx_hash).toBeNull();
    expect(fake.refundCalls).toHaveLength(0);
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(0);
  });
});
