// Notifications — unit validation plus live-DB integration
// (writers fire exactly once inside the funding/delivery transactions;
// endpoints are owner-scoped and idempotent).
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { AppError } from '../src/http/errors';
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
import { validateNotificationInput } from '../src/notifications/service';

const TEST_CONTRACT = '0x3333333333333333333333333333333333333333';
process.env.USDT_ESCROW_CONTRACT_ADDRESS = TEST_CONTRACT;
process.env.USDT_TOKEN_ADDRESS = '0x4444444444444444444444444444444444444444';

const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function truncateDisplay(wallet: string): string {
  const compact = wallet.replace(/ /g, '').toUpperCase();
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

describe('notification input validation (no DB)', () => {
  const valid = {
    userId: randomUUID(),
    type: 'slot_funded',
    entityType: 'slot',
    entityId: randomUUID(),
    title: 'Slot funded',
    body: 'Your slot "X" was funded.',
  };

  it('accepts the two event types', () => {
    expect(() => validateNotificationInput(valid)).not.toThrow();
    expect(() => validateNotificationInput({ ...valid, type: 'slot_delivered' })).not.toThrow();
  });

  it('rejects unknown types and entity types with a 500', () => {
    for (const bad of [
      { ...valid, type: 'slot_released' },
      { ...valid, type: '' },
      { ...valid, entityType: 'user' },
      { ...valid, entityType: '' },
    ]) {
      try {
        validateNotificationInput(bad);
        expect.unreachable('expected a 500 for invalid notification input');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
      }
    }
  });

  it('rejects empty ids, titles, and bodies', () => {
    for (const bad of [
      { ...valid, entityId: '' },
      { ...valid, title: '   ' },
      { ...valid, body: '' },
    ]) {
      expect(() => validateNotificationInput(bad)).toThrowError(AppError);
    }
  });
});

describe.skipIf(!isDatabaseConfigured())('notifications (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const depositEvents = new Map<string, DepositedEvent>();

  const escrowClient: EscrowContractClient = {
    async getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
      return depositEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getDisputeEvent() {
      return null;
    },
    async getTransactionReceipt() {
      return null;
    },
    async release(escrowId: string, toProvider: string) {
      void escrowId;
      void toProvider;
      return { txHash: freshTxHash() };
    },
    async refund(escrowId: string) {
      void escrowId;
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
      notifications: { windowMs: 60_000, max: 1000 },
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

  async function makeSlotFor(providerId: string, title: string): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title,
      description: `NOTIF ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: SLOT_PRICE,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: validPayout(),
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

  async function fundClaim(
    buyerCookie: string,
    claimId: string,
  ): Promise<{ onChainEscrowId: string }> {
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
    return { onChainEscrowId };
  }

  /** Full deposit flow through escrow_funded. */
  async function fundedSetup(title: string): Promise<{
    buyerCookie: string;
    providerCookie: string;
    buyerWallet: string;
    claimId: string;
  }> {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    const slotId = await makeSlotFor(providerId, title);
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    const claimId = await claimAs(buyerCookie, slotId);
    await fundClaim(buyerCookie, claimId);
    return { buyerCookie, providerCookie, buyerWallet, claimId };
  }

  async function listAs(cookie: string): Promise<{ notifications: Record<string, unknown>[]; unreadCount: number }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { notifications: Record<string, unknown>[]; unreadCount: number } }).data;
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

  it('verify-deposit success writes exactly one provider notification', async () => {
    const title = `NOTIF ${tag} funded table`;
    const { providerCookie, buyerWallet } = await fundedSetup(title);
    const data = await listAs(providerCookie);
    expect(data.unreadCount).toBe(1);
    expect(data.notifications).toHaveLength(1);
    const note = data.notifications[0] as Record<string, unknown>;
    expect(note['type']).toBe('slot_funded');
    expect(note['entity_type']).toBe('slot');
    expect(typeof note['entity_id']).toBe('string');
    expect(note['title']).toBe('Slot funded');
    expect(note['read_at']).toBeNull();
    const body = String(note['body']);
    expect(body).toContain(title);
    expect(body).toContain(truncateDisplay(buyerWallet));
    // Never the full counterparty wallet.
    expect(body).not.toContain(buyerWallet);
  });

  it('repeat verify-deposit does not double-write', async () => {
    const { buyerCookie, providerCookie, claimId } = await fundedSetup(`NOTIF ${tag} idempotent`);
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(again.statusCode).toBe(200);
    const data = await listAs(providerCookie);
    expect(data.notifications).toHaveLength(1);
    expect(data.unreadCount).toBe(1);
  });

  it('concurrent verify-deposit writes exactly one notification', async () => {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    const slotId = await makeSlotFor(providerId, `NOTIF ${tag} race`);
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    const claimId = await claimAs(buyerCookie, slotId);
    // Intent + submission, then two verifies race the conditional UPDATE.
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
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        app.inject({
          method: 'POST',
          url: `/api/v1/claims/${claimId}/verify-deposit`,
          headers: { cookie: buyerCookie, ...CSRF },
          payload: {},
        }),
      ),
    );
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      expect((r as PromiseFulfilledResult<InjectResponse>).value.statusCode).toBe(200);
    }
    const data = await listAs(providerCookie);
    expect(data.notifications).toHaveLength(1);
    void buyerWallet;
  });

  it('a pending verification writes nothing (rollback proof)', async () => {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    const slotId = await makeSlotFor(providerId, `NOTIF ${tag} pending`);
    const buyerCookie = await loginAs(randomWallet());
    const claimId = await claimAs(buyerCookie, slotId);
    const intent = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: { token: 'USDT_POLYGON' },
    });
    expect(intent.statusCode).toBe(200);
    // Submitted but no chain event registered: verify stays pending.
    const submission = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-submission`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: { transactionHash: freshTxHash() },
    });
    expect(submission.statusCode).toBe(200);
    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(verify.statusCode).toBe(200);
    const data = await listAs(providerCookie);
    expect(data.notifications).toHaveLength(0);
    expect(data.unreadCount).toBe(0);
  });

  it('mark-delivered success writes exactly one buyer notification', async () => {
    const title = `NOTIF ${tag} delivered table`;
    const { buyerCookie, providerCookie, claimId } = await fundedSetup(title);
    const delivered = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(delivered.statusCode).toBe(200);
    const data = await listAs(buyerCookie);
    expect(data.unreadCount).toBe(1);
    expect(data.notifications).toHaveLength(1);
    const note = data.notifications[0] as Record<string, unknown>;
    expect(note['type']).toBe('slot_delivered');
    expect(note['entity_type']).toBe('claim');
    expect(note['entity_id']).toBe(claimId);
    expect(note['title']).toBe('Marked delivered');
    const body = String(note['body']);
    expect(body).toContain(title);
    expect(body).toContain('confirm receipt');
    // Provider sees nothing for the delivery of their own slot.
    const providerData = await listAs(providerCookie);
    expect(providerData.notifications).toHaveLength(1);
    expect(providerData.notifications[0]?.['type']).toBe('slot_funded');
  });

  it('a failed mark-delivered writes nothing', async () => {
    const { providerCookie, claimId } = await fundedSetup(`NOTIF ${tag} nodivert`);
    // Foreign provider: 404, no state change, no notification.
    const stranger = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: stranger, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(res.statusCode).toBe(404);
    const data = await listAs(providerCookie);
    // Only the funding notification exists; no delivery notification.
    expect(data.notifications).toHaveLength(1);
  });

  it('list is newest-first with an unread count; read is idempotent', async () => {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    for (const title of [`NOTIF ${tag} first`, `NOTIF ${tag} second`]) {
      const slotId = await makeSlotFor(providerId, title);
      const buyerCookie = await loginAs(randomWallet());
      const claimId = await claimAs(buyerCookie, slotId);
      await fundClaim(buyerCookie, claimId);
    }
    const data = await listAs(providerCookie);
    expect(data.notifications).toHaveLength(2);
    expect(data.unreadCount).toBe(2);
    const [first, second] = data.notifications as Record<string, unknown>[];
    expect(String(first?.['created_at']) >= String(second?.['created_at'])).toBe(true);
    expect(first?.['body']).toContain('second');
    const firstId = String(first?.['id']);
    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${firstId}/read`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: {},
    });
    expect(read.statusCode).toBe(200);
    expect(
      (read.json() as { data: { notification: Record<string, unknown> } }).data.notification['read_at'],
    ).not.toBeNull();
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${firstId}/read`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: {},
    });
    expect(again.statusCode).toBe(200);
    const after = await listAs(providerCookie);
    expect(after.unreadCount).toBe(1);
  });

  it('read-all marks everything; foreign reads 404; anonymous 401s', async () => {
    const { buyerCookie, providerCookie, claimId } = await fundedSetup(`NOTIF ${tag} readall`);
    const delivered = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(delivered.statusCode).toBe(200);
    const buyerList = await listAs(buyerCookie);
    const buyerNoteId = String((buyerList.notifications[0] as Record<string, unknown>)['id']);

    // Foreign user reads someone else's notification → 404.
    const stranger = await loginAs(randomWallet());
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${buyerNoteId}/read`,
      headers: { cookie: stranger, ...CSRF },
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);

    // Anonymous → 401.
    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/me/notifications/${buyerNoteId}/read`,
      payload: {},
    });
    expect(anon.statusCode).toBe(401);

    // Read-all clears the buyer's badge.
    const readAll = await app.inject({
      method: 'POST',
      url: '/api/v1/me/notifications/read-all',
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(readAll.statusCode).toBe(200);
    expect((readAll.json() as { data: { marked: number } }).data.marked).toBe(1);
    const cleared = await listAs(buyerCookie);
    expect(cleared.unreadCount).toBe(0);
  });
});
