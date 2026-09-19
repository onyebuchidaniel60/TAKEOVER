// Delivery + USDT release integration (live DB, mocked client).
// Auth via the real challenge/verify flow with an injected signature stub.
// The Polygon client is a test-double implementing EscrowContractClient
// (release broadcast + receipt polling); real signing is never exercised here
// (no live contract exists yet) and is covered by escrow-signer.test.ts.
// Fresh claims per test keep limiters isolated; budgets are disabled on the
// main app (sweep precedent).
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import {
  EscrowContractUnavailableError,
  EscrowSignerUnavailableError,
} from '../src/escrow/polygon/client';
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
  notifications,
  sessions,
  slots,
  users,
} from '../../../db/schema';

const TEST_CONTRACT = '0x3333333333333333333333333333333333333333';
process.env.USDT_ESCROW_CONTRACT_ADDRESS = TEST_CONTRACT;
// Intent fail-closes without a token address.
process.env.USDT_TOKEN_ADDRESS = '0x4444444444444444444444444444444444444444';

const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RELEASE_TX = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

describe.skipIf(!isDatabaseConfigured())('escrow delivery and USDT release (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    releaseCalls: { escrowId: string; toProvider: string }[];
    receiptCalls: string[];
    releaseTxHash: string;
    receipt: { confirmations: number } | null;
    failRelease: 'signer' | 'contract' | null;
  } = { releaseCalls: [], receiptCalls: [], releaseTxHash: RELEASE_TX, receipt: null, failRelease: null };

  const depositEvents = new Map<string, DepositedEvent>();

  const escrowClient: EscrowContractClient = {
    async getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
      return depositEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getDisputeEvent() {
      return null;
    },
    async getTransactionReceipt(txHash: string) {
      fake.receiptCalls.push(txHash);
      return fake.receipt;
    },
    async release(escrowId: string, toProvider: string) {
      fake.releaseCalls.push({ escrowId, toProvider });
      if (fake.failRelease === 'signer') {
        throw new EscrowSignerUnavailableError('boom');
      }
      if (fake.failRelease === 'contract') {
        throw new EscrowContractUnavailableError('boom');
      }
      return { txHash: fake.releaseTxHash };
    },
    async refund() {
      throw new Error('not implemented in this fake');
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
    fake.releaseCalls = [];
    fake.receiptCalls = [];
    // Fresh broadcast hash per test: release_tx_hash is UNIQUE across rows,
    // so reusing one constant would collide with earlier tests' escrows.
    fake.releaseTxHash = freshTxHash();
    fake.receipt = null;
    fake.failRelease = null;
    depositEvents.clear();
  }

  async function auditCount(claimId: string, eventType: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, claimId), eq(auditEvents.eventType, eventType)));
    return rows.length;
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
        await db.delete(notifications).where(inArray(notifications.userId, userIds));
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('mark-delivered happy path: delivered with payout, deadlines, one audit', { timeout: 60_000 }, async () => {
    resetFake();
    const { providerCookie, claimId } = await fundedSetup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        claim: { status: string };
        escrow: {
          status: string;
          provider_payout_address: string;
          delivered_at: string;
          dispute_window_ends: string;
        };
      };
    };
    expect(body.data.claim.status).toBe('delivered');
    expect(body.data.escrow.status).toBe('delivered');
    expect(body.data.escrow.provider_payout_address).toBe(PAYOUT.toLowerCase());
    expect(typeof body.data.escrow.delivered_at).toBe('string');
    const deliveredAt = new Date(body.data.escrow.delivered_at).getTime();
    const windowEnds = new Date(body.data.escrow.dispute_window_ends).getTime();
    expect(windowEnds - deliveredAt).toBe(86400 * 1000);
    expect(await auditCount(claimId, 'escrow.delivered')).toBe(1);
  });

  it('mark-delivered idempotent on same address, 409 on different', { timeout: 60_000 }, async () => {
    resetFake();
    const { providerCookie, claimId } = await fundedSetup();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(first.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT.toUpperCase() },
    });
    expect(again.statusCode).toBe(200);
    expect(await auditCount(claimId, 'escrow.delivered')).toBe(1);
    const other = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    });
    expect(other.statusCode).toBe(409);
    expect((other.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('mark-delivered: foreign provider 404, buyer caller 404, wrong state 409, bad address 400', { timeout: 90_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId } = await fundedSetup();
    const stranger = await loginAs(randomWallet());
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: stranger, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(foreign.statusCode).toBe(404);
    const byBuyer = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(byBuyer.statusCode).toBe(404);
    expect((byBuyer.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_FOUND');
    // Wrong state: deposit_submitted claim (escrow created, never funded).
    const buyer2 = randomWallet();
    const buyer2Cookie = await loginAs(buyer2);
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    const slotId = await makeSlotFor(providerId);
    const holdId = await claimAs(buyer2Cookie, slotId);
    const intent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${holdId}/escrow-intent`,
      headers: { cookie: buyer2Cookie, ...CSRF },
      payload: { token: 'USDT_POLYGON' },
    });
    expect(intent.statusCode).toBe(200);
    const submission = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${holdId}/escrow-submission`,
      headers: { cookie: buyer2Cookie, ...CSRF },
      payload: { transactionHash: freshTxHash() },
    });
    expect(submission.statusCode).toBe(200);
    const wrongState = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${holdId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(wrongState.statusCode).toBe(409);
    // Malformed address → 400 (checked before any state read matters).
    const badAddress = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: 'not-an-address' },
    });
    expect(badAddress.statusCode).toBe(400);
  });

  it('confirm-receipt happy path: pending then released with audits', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId, onChainEscrowId } = await deliveredSetup();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { status: string } }).data.status).toBe('pending');
    expect(fake.releaseCalls).toEqual([{ escrowId: onChainEscrowId, toProvider: PAYOUT.toLowerCase() }]);
    const db = getDb();
    const stored = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(stored[0]?.releaseTxHash).toBe(fake.releaseTxHash);
    expect(await auditCount(claimId, 'escrow.release_submitted')).toBe(1);
    fake.receipt = { confirmations: 9 };
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { data: { status: string; claim: { status: string }; escrow: { status: string } } };
    expect(body.data.status).toBe('released');
    expect(body.data.claim.status).toBe('released');
    expect(body.data.escrow.status).toBe('released');
    expect(await auditCount(claimId, 'escrow.released')).toBe(1);
  });

  it('confirm-receipt: null receipt → pending; below threshold → pending with count', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId } = await deliveredSetup();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { status: string } }).data.status).toBe('pending');
    fake.receipt = null;
    const stillPending = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(stillPending.statusCode).toBe(200);
    expect((stillPending.json() as { data: { status: string } }).data.status).toBe('pending');
    fake.receipt = { confirmations: 1 };
    const under = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(under.statusCode).toBe(200);
    expect((under.json() as { data: { status: string; confirmations: number } }).data).toMatchObject({
      status: 'pending',
      confirmations: 1,
    });
    const db = getDb();
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('delivered');
  });

  it('concurrent confirm-receipt → one transition, one no-op, single released row', { timeout: 60_000 }, async () => {
    resetFake();
    const db = getDb();
    const { buyerCookie, claimId } = await deliveredSetup();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    fake.receipt = { confirmations: 12 };
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/claims/${claimId}/confirm-receipt`,
        headers: { cookie: buyerCookie, ...CSRF },
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/claims/${claimId}/confirm-receipt`,
        headers: { cookie: buyerCookie, ...CSRF },
        payload: {},
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { data: { status: string } }).data.status).toBe('released');
    expect((b.json() as { data: { status: string } }).data.status).toBe('released');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(escrowRows).toHaveLength(1);
    expect(escrowRows[0]?.status).toBe('released');
    expect(await auditCount(claimId, 'escrow.released')).toBe(1);
  });

  it('already released → 200 no-op without any RPC call', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId } = await deliveredSetup();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    fake.receipt = { confirmations: 30 };
    const released = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect((released.json() as { data: { status: string } }).data.status).toBe('released');
    fake.releaseCalls = [];
    fake.receiptCalls = [];
    fake.receipt = null;
    const noop = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(noop.statusCode).toBe(200);
    expect((noop.json() as { data: { status: string } }).data.status).toBe('released');
    expect(fake.releaseCalls).toHaveLength(0);
    expect(fake.receiptCalls).toHaveLength(0);
  });

  it('signer / contract failure → 503 ESCROW_RELEASE_FAILED, no state change', { timeout: 60_000 }, async () => {
    resetFake();
    const db = getDb();
    const { buyerCookie, claimId } = await deliveredSetup();
    fake.failRelease = 'signer';
    const signerFail = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(signerFail.statusCode).toBe(503);
    expect((signerFail.json() as { error: { code: string } }).error.code).toBe('ESCROW_RELEASE_FAILED');
    fake.failRelease = 'contract';
    const contractFail = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(contractFail.statusCode).toBe(503);
    expect((contractFail.json() as { error: { code: string } }).error.code).toBe('ESCROW_RELEASE_FAILED');
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(claimRows[0]?.status).toBe('delivered');
    expect(escrowRows[0]?.status).toBe('delivered');
    expect(escrowRows[0]?.releaseTxHash).toBeNull();
  });

  it('confirm-receipt: foreign buyer 404, wrong state 409, anonymous 401', { timeout: 60_000 }, async () => {
    resetFake();
    const { claimId } = await deliveredSetup();
    const stranger = await loginAs(randomWallet());
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      headers: { cookie: stranger, ...CSRF },
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);
    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/confirm-receipt`,
      payload: {},
    });
    expect(anon.statusCode).toBe(401);
    // Wrong state: funded but never delivered.
    const setup = await fundedSetup();
    const early = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${setup.claimId}/confirm-receipt`,
      headers: { cookie: setup.buyerCookie, ...CSRF },
      payload: {},
    });
    expect(early.statusCode).toBe(409);
  });

  it('mark-delivered anonymous → 401; GET /escrow buyer/provider/stranger matrix', { timeout: 60_000 }, async () => {
    resetFake();
    const { buyerCookie, providerCookie, claimId } = await deliveredSetup();
    const anonMark = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(anonMark.statusCode).toBe(401);
    const byProvider = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: providerCookie },
    });
    expect(byProvider.statusCode).toBe(200);
    const providerBody = byProvider.json() as {
      data: {
        escrow: {
          status: string;
          provider_payout_address: string;
          delivered_at: string;
          dispute_window_ends: string;
          release_tx_hash: string | null;
        };
      };
    };
    expect(providerBody.data.escrow.status).toBe('delivered');
    expect(providerBody.data.escrow.provider_payout_address).toBe(PAYOUT.toLowerCase());
    expect(typeof providerBody.data.escrow.delivered_at).toBe('string');
    expect(typeof providerBody.data.escrow.dispute_window_ends).toBe('string');
    expect(providerBody.data.escrow.release_tx_hash).toBeNull();
    const byBuyer = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(byBuyer.statusCode).toBe(200);
    const stranger = await loginAs(randomWallet());
    const byStranger = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: stranger },
    });
    expect(byStranger.statusCode).toBe(404);
  });
});
