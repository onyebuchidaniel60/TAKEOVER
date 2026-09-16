// Phase 14d-3b: admin dispute resolution + escrow list (live DB, mocked
// Polygon client). Disputed fixtures flow through the real buyer/provider
// endpoints; admin promotion uses the real ADMIN_WALLET_ADDRESSES env (set
// only around the admin login, then cleared — moderation.test.ts pattern).
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

const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe.skipIf(!isDatabaseConfigured())('admin escrow resolve and list (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    refundCalls: string[];
    releaseCalls: { escrowId: string; toProvider: string }[];
    receiptCalls: string[];
    receipt: { confirmations: number } | null;
  } = { refundCalls: [], releaseCalls: [], receiptCalls: [], receipt: null };

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
      return { txHash: freshTxHash() };
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
      admin: { windowMs: 60_000, max: 1000 },
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

  /** Full flow through disputed: funded → delivered → Disputed event → disputed. */
  async function disputedSetup(): Promise<{
    buyerCookie: string;
    providerCookie: string;
    claimId: string;
    escrowId: string;
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
    disputeEvents.set(setup.onChainEscrowId.toLowerCase(), {
      escrowId: setup.onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: null,
      txHash: freshTxHash(),
      blockNumber: 101,
    });
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${setup.claimId}/dispute`,
      headers: { cookie: setup.buyerCookie, ...CSRF },
      payload: {},
    });
    expect(opened.statusCode).toBe(200);
    expect((opened.json() as { data: { status: string } }).data.status).toBe('disputed');
    const db = getDb();
    const rows = await db
      .select({ id: escrows.id })
      .from(escrows)
      .where(eq(escrows.claimId, setup.claimId))
      .limit(1);
    if (!rows[0]) throw new Error('expected escrow row');
    return { ...setup, escrowId: rows[0].id };
  }

  function resetFake(): void {
    fake.refundCalls = [];
    fake.releaseCalls = [];
    fake.receiptCalls = [];
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

  it('admin resolve release: disputed → releasing → released', { timeout: 90_000 }, async () => {
    resetFake();
    const { buyerCookie, providerCookie, claimId, escrowId, onChainEscrowId } = await disputedSetup();
    const { cookie: adminCookie } = await loginAdmin();
    const resolve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/escrows/${escrowId}/resolve`,
      headers: { cookie: adminCookie, ...CSRF },
      payload: { action: 'release', resolutionNotes: 'Provider delivered as promised.' },
    });
    expect(resolve.statusCode).toBe(200);
    const body = resolve.json() as {
      data: {
        status: string;
        escrow: { status: string; release_tx_hash: string | null; resolution_notes: string | null };
      };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.escrow.status).toBe('releasing');
    expect(typeof body.data.escrow.release_tx_hash).toBe('string');
    expect(body.data.escrow.resolution_notes).toBe('Provider delivered as promised.');
    expect(fake.releaseCalls).toEqual([{ escrowId: onChainEscrowId, toProvider: PAYOUT.toLowerCase() }]);
    expect(await auditCount(claimId, 'escrow.releasing')).toBe(1);
    fake.receipt = { confirmations: 3 };
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json() as {
      data: { escrow: { status: string; resolution_notes: string | null }; claim: { status: string } };
    };
    expect(readBody.data.escrow.status).toBe('released');
    expect(readBody.data.claim.status).toBe('released');
    // Buyer sees THAT a resolution happened, not the admin's reasoning.
    expect(readBody.data.escrow.resolution_notes).toBeNull();
    const byProvider = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: providerCookie },
    });
    expect(byProvider.statusCode).toBe(200);
    expect(
      (byProvider.json() as { data: { escrow: { resolution_notes: string | null } } }).data.escrow
        .resolution_notes,
    ).toBe('Provider delivered as promised.');
    expect(await auditCount(claimId, 'escrow.released')).toBe(1);
  });

  it('admin resolve refund: disputed → refunding → refunded', { timeout: 90_000 }, async () => {
    resetFake();
    const { buyerCookie, claimId, escrowId, onChainEscrowId } = await disputedSetup();
    const { cookie: adminCookie } = await loginAdmin();
    const resolve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/escrows/${escrowId}/resolve`,
      headers: { cookie: adminCookie, ...CSRF },
      payload: { action: 'refund', resolutionNotes: 'Delivery never happened.' },
    });
    expect(resolve.statusCode).toBe(200);
    const body = resolve.json() as {
      data: { status: string; escrow: { status: string; refund_tx_hash: string | null } };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.escrow.status).toBe('refunding');
    expect(typeof body.data.escrow.refund_tx_hash).toBe('string');
    expect(fake.refundCalls).toEqual([onChainEscrowId]);
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(1);
    fake.receipt = { confirmations: 5 };
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie: buyerCookie },
    });
    expect(read.statusCode).toBe(200);
    const readBody = read.json() as {
      data: { escrow: { status: string }; claim: { status: string } };
    };
    expect(readBody.data.escrow.status).toBe('refunded');
    expect(readBody.data.claim.status).toBe('refunded');
    expect(await auditCount(claimId, 'escrow.refunded')).toBe(1);
  });

  it('admin resolve wrong state → 409 ESCROW_DISPUTE_NOT_OPEN', { timeout: 60_000 }, async () => {
    resetFake();
    const { claimId } = await fundedSetup();
    const db = getDb();
    const rows = await db
      .select({ id: escrows.id })
      .from(escrows)
      .where(eq(escrows.claimId, claimId))
      .limit(1);
    if (!rows[0]) throw new Error('expected escrow row');
    const { cookie: adminCookie } = await loginAdmin();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/escrows/${rows[0].id}/resolve`,
      headers: { cookie: adminCookie, ...CSRF },
      payload: { action: 'refund', resolutionNotes: 'Too early for this.' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_DISPUTE_NOT_OPEN');
    expect(fake.refundCalls).toHaveLength(0);
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(0);
  });

  it('concurrent resolves: one 200, one 409 CONFLICT, single audit', { timeout: 60_000 }, async () => {
    resetFake();
    const { claimId, escrowId } = await disputedSetup();
    const { cookie: adminCookie } = await loginAdmin();
    const payload = { action: 'refund', resolutionNotes: 'First writer wins here.' } as const;
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/admin/escrows/${escrowId}/resolve`,
        headers: { cookie: adminCookie, ...CSRF },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/admin/escrows/${escrowId}/resolve`,
        headers: { cookie: adminCookie, ...CSRF },
        payload,
      }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    expect((loser.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
    expect(fake.refundCalls).toHaveLength(1);
    expect(await auditCount(claimId, 'escrow.refunding')).toBe(1);
  });

  it('admin list runs lazy transitions: releasing flips to released in the list response', { timeout: 90_000 }, async () => {
    resetFake();
    // Only admin resolve can create a releasing row, so a status=releasing
    // page can never contain another test file's fixtures — this sweep
    // coverage is free of the shared-DB race documented in the list test.
    const { claimId, escrowId } = await disputedSetup();
    const { cookie: adminCookie } = await loginAdmin();
    const resolve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/escrows/${escrowId}/resolve`,
      headers: { cookie: adminCookie, ...CSRF },
      payload: { action: 'release', resolutionNotes: 'Sweep me via list.' },
    });
    expect(resolve.statusCode).toBe(200);
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows?status=releasing&limit=50',
      headers: { cookie: adminCookie },
    });
    expect(pending.statusCode).toBe(200);
    const pendingBody = pending.json() as {
      data: { escrows: { claim_id: string; status: string }[] };
    };
    expect(pendingBody.data.escrows.some((e) => e.claim_id === claimId && e.status === 'releasing')).toBe(true);
    fake.receipt = { confirmations: 3 };
    const swept = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows?status=releasing&limit=50',
      headers: { cookie: adminCookie },
    });
    expect(swept.statusCode).toBe(200);
    const sweptBody = swept.json() as {
      data: { escrows: { claim_id: string; status: string; resolved_at: string | null }[] };
    };
    // The page was queried before the sweep, so the row is still listed —
    // but projected post-transition: released with resolved_at set.
    const found = sweptBody.data.escrows.find((e) => e.claim_id === claimId);
    expect(found?.status).toBe('released');
    expect(typeof found?.resolved_at).toBe('string');
    expect(await auditCount(claimId, 'escrow.released')).toBe(1);
    const db = getDb();
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    expect(claimRows[0]?.status).toBe('released');
  });

  it('admin escrow list: auth matrix, filter, pagination, no secrets', { timeout: 60_000 }, async () => {
    resetFake();
    const { claimId } = await disputedSetup();
    const anon = await app.inject({ method: 'GET', url: '/api/v1/admin/escrows' });
    expect(anon.statusCode).toBe(401);
    const stranger = await loginAs(randomWallet());
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows',
      headers: { cookie: stranger },
    });
    expect(forbidden.statusCode).toBe(403);
    const { cookie: adminCookie } = await loginAdmin();
    // NOTE: every list call below is status-scoped on purpose. The admin
    // list runs checkEscrowTransitions on every row in the page, and all
    // test files share one live DB — an unscoped call could sweep another
    // file's transient eligible rows (e.g. a funded+expired escrow mid
    // auto-refund test) and steal its broadcast. Status scoping keeps each
    // file's fixtures to itself.
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows?status=disputed&limit=50',
      headers: { cookie: adminCookie },
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as {
      data: { escrows: { claim_id: string; status: string }[]; total: number };
    };
    expect(allBody.data.total).toBeGreaterThanOrEqual(1);
    expect(allBody.data.escrows.some((e) => e.claim_id === claimId && e.status === 'disputed')).toBe(true);
    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows?status=disputed&limit=50',
      headers: { cookie: adminCookie },
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = filtered.json() as { data: { escrows: { status: string }[] } };
    expect(filteredBody.data.escrows.length).toBeGreaterThanOrEqual(1);
    expect(filteredBody.data.escrows.every((e) => e.status === 'disputed')).toBe(true);
    const page = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/escrows?status=disputed&limit=1&offset=0',
      headers: { cookie: adminCookie },
    });
    expect(page.statusCode).toBe(200);
    expect((page.json() as { data: { escrows: unknown[]; limit: number } }).data.escrows).toHaveLength(1);
    // Secret scan: no private keys, no signature bodies anywhere in the payload.
    const serialized = JSON.stringify(all.json());
    expect(serialized).not.toContain('PRIVATE_KEY');
    expect(serialized).not.toContain('privateKey');
    expect(serialized).not.toContain('private_key');
    expect(serialized).not.toMatch(/"signature"\s*:/);
  });
});
