// Phase 14d-4: provider contact-note endpoint + buyer visibility gate (live
// DB, mocked Polygon client). Auth via the real challenge/verify flow with
// an injected signature stub. Fresh claims per test keep limiters isolated;
// budgets are disabled on the main app (Phase 13 sweep precedent). Escrow
// statuses past `disputed` are set with direct row updates — the gate reads
// the status only, and the tests own their fixtures (dispute-refund
// precedent for time travel via direct updates).
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
const NOTE = 'Meet at the side entrance and ask for Maria.';

describe.skipIf(!isDatabaseConfigured())('provider contact note (live DB, mocked Polygon)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const depositEvents = new Map<string, DepositedEvent>();
  const disputeEvents = new Map<string, DisputedEvent>();

  const escrowClient: EscrowContractClient = {
    async getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
      return depositEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getDisputeEvent(escrowId: string): Promise<DisputedEvent | null> {
      return disputeEvents.get(escrowId.toLowerCase()) ?? null;
    },
    async getTransactionReceipt() {
      // No confirmations ever: transitional rows stay put (deterministic).
      return null;
    },
    async release() {
      return { txHash: freshTxHash() };
    },
    async refund() {
      return { txHash: freshTxHash() };
    },
  };

  const app = buildApp({
    verifySignature: stubVerifier,
    escrowClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
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

  async function makeSlotFor(providerId: string, status: 'draft' | 'published' = 'published'): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `NOTE ${tag} slot`,
      description: `NOTE ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: SLOT_PRICE,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: validPayout(),
      status,
      publishedAt: status === 'published' ? new Date() : null,
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

  async function patchNote(
    cookie: string | null,
    slotId: string,
    body: Record<string, unknown>,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/me/slots/${slotId}/contact-note`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: body,
    });
  }

  async function claimView(cookie: string, claimId: string): Promise<{ status: number; claim: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}`,
      headers: { cookie },
    });
    return { status: res.statusCode, claim: (res.json() as { data: { claim: Record<string, unknown> } }).data.claim };
  }

  async function escrowViews(cookie: string, claimId: string): Promise<{ status: number; escrow: Record<string, unknown>; claim: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}/escrow`,
      headers: { cookie },
    });
    const data = res.json() as { data: { escrow: Record<string, unknown>; claim: Record<string, unknown> } };
    return { status: res.statusCode, escrow: data.data.escrow, claim: data.data.claim };
  }

  async function auditRows(entityId: string, eventType: string): Promise<{ metadata: unknown }[]> {
    const db = getDb();
    return db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.eventType, eventType)))
      .orderBy(auditEvents.createdAt);
  }

  async function setEscrowStatus(
    claimId: string,
    status: 'releasing' | 'released' | 'refunding' | 'refunded',
    txHashField?: 'releaseTxHash' | 'refundTxHash',
  ): Promise<void> {
    const db = getDb();
    const patch: { status: typeof status; releaseTxHash?: string; refundTxHash?: string } = { status };
    if (txHashField === 'releaseTxHash') {
      patch.releaseTxHash = freshTxHash();
    }
    if (txHashField === 'refundTxHash') {
      patch.refundTxHash = freshTxHash();
    }
    await db.update(escrows).set(patch).where(eq(escrows.claimId, claimId));
  }

  /** One provider + slot + buyer + claim, with the note set. Returns sessions. */
  async function noteSetup(): Promise<{ providerCookie: string; buyerCookie: string; slotId: string; claimId: string }> {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1]);
    const slotId = await makeSlotFor(providerId);
    const set = await patchNote(providerCookie, slotId, { provider_contact_note: NOTE });
    expect(set.statusCode).toBe(200);
    const buyerCookie = await loginAs(randomWallet());
    const claimId = await claimAs(buyerCookie, slotId);
    return { providerCookie, buyerCookie, slotId, claimId };
  }

  /** Full deposit flow through escrow_funded (dispute-refund precedent). */
  async function fundClaim(buyerCookie: string, claimId: string): Promise<string> {
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
    return onChainEscrowId;
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
      // Slot-scoped audits (slot.contact_note_updated) reference slot ids.
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, slotIds));
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

  it('PATCH own slot persists the note and audits without the text', { timeout: 60_000 }, async () => {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1]);
    const slotId = await makeSlotFor(providerId);
    const res = await patchNote(providerCookie, slotId, { provider_contact_note: NOTE });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> }; requestId: string };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.slot['provider_contact_note']).toBe(NOTE);
    const rows = await auditRows(slotId, 'slot.contact_note_updated');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ slotId, hadNote: false, noteLength: NOTE.length });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(NOTE.slice(0, 12));
  });

  it('PATCH non-owned slot 404s and anonymous 401s', { timeout: 60_000 }, async () => {
    const ownerCookie = await loginAs(randomWallet());
    const ownerId = await userIdFor(wallets[wallets.length - 1]);
    const slotId = await makeSlotFor(ownerId);
    const strangerCookie = await loginAs(randomWallet());
    const foreign = await patchNote(strangerCookie, slotId, { provider_contact_note: NOTE });
    expect(foreign.statusCode).toBe(404);
    expect((foreign.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    const anon = await patchNote(null, slotId, { provider_contact_note: NOTE });
    expect(anon.statusCode).toBe(401);
    const missing = await patchNote(ownerCookie, randomUUID(), { provider_contact_note: NOTE });
    expect(missing.statusCode).toBe(404);
    expect(await auditRows(slotId, 'slot.contact_note_updated')).toHaveLength(0);
  });

  it('PATCH rejects bad bodies with 400 INVALID_INPUT', { timeout: 60_000 }, async () => {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1]);
    const slotId = await makeSlotFor(providerId);
    for (const body of [
      { provider_contact_note: '' },
      { provider_contact_note: '   ' },
      { provider_contact_note: 'x'.repeat(501) },
      { provider_contact_note: 'call https://example.com/x' },
      { provider_contact_note: 'see WWW.example.com/menu' },
      { provider_contact_note: 'pay myapp://merchant/42' },
      { provider_contact_note: NOTE, extra: 1 },
      { provider_contact_note: 42 },
      {},
    ]) {
      const res = await patchNote(providerCookie, slotId, body);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    }
    expect(await auditRows(slotId, 'slot.contact_note_updated')).toHaveLength(0);
  });

  it('PATCH null clears and same-value re-set is a no-op without a second audit', { timeout: 60_000 }, async () => {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1]);
    const slotId = await makeSlotFor(providerId);
    expect((await patchNote(providerCookie, slotId, { provider_contact_note: NOTE })).statusCode).toBe(200);
    const cleared = await patchNote(providerCookie, slotId, { provider_contact_note: null });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { data: { slot: { provider_contact_note: string | null } } }).data.slot.provider_contact_note).toBeNull();
    const repeat = await patchNote(providerCookie, slotId, { provider_contact_note: null });
    expect(repeat.statusCode).toBe(200);
    const rows = await auditRows(slotId, 'slot.contact_note_updated');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.metadata).toEqual({ slotId, hadNote: true, noteLength: 0 });
  });

  it('owner projection carries the note; public detail does not', { timeout: 60_000 }, async () => {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1]);
    const draftId = await makeSlotFor(providerId, 'draft');
    expect((await patchNote(providerCookie, draftId, { provider_contact_note: NOTE })).statusCode).toBe(200);
    // Owner view of a non-public slot carries the note.
    const ownerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${draftId}`,
      headers: { cookie: providerCookie },
    });
    expect(ownerRes.statusCode).toBe(200);
    expect((ownerRes.json() as { data: { slot: Record<string, unknown> } }).data.slot['provider_contact_note']).toBe(NOTE);
    // GET /me/slots carries it too.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/slots',
      headers: { cookie: providerCookie },
    });
    expect(listRes.statusCode).toBe(200);
    const listed = (listRes.json() as { data: { slots: Record<string, unknown>[] } }).data.slots.find(
      (s) => s['id'] === draftId,
    );
    expect(listed?.['provider_contact_note']).toBe(NOTE);
    // Public anonymous detail of a published slot never carries the field.
    const publishedId = await makeSlotFor(providerId, 'published');
    expect((await patchNote(providerCookie, publishedId, { provider_contact_note: NOTE })).statusCode).toBe(200);
    const publicRes = await app.inject({ method: 'GET', url: `/api/v1/slots/${publishedId}` });
    expect(publicRes.statusCode).toBe(200);
    expect(
      (publicRes.json() as { data: { slot: Record<string, unknown> } }).data.slot,
    ).not.toHaveProperty('provider_contact_note');
  });

  it('buyer claim view hides the note with no escrow and shows it once funded', { timeout: 60_000 }, async () => {
    const { buyerCookie, claimId } = await noteSetup();
    const bare = await claimView(buyerCookie, claimId);
    expect(bare.status).toBe(200);
    expect(bare.claim['provider_contact_note']).toBeNull();
    await fundClaim(buyerCookie, claimId);
    const funded = await claimView(buyerCookie, claimId);
    expect(funded.status).toBe(200);
    expect(funded.claim['provider_contact_note']).toBe(NOTE);
  });

  it('gate matrix on the buyer claim view across all escrow statuses', { timeout: 120_000 }, async () => {
    const { buyerCookie, providerCookie, claimId } = await noteSetup();
    // created: intent only, no deposit yet.
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
    expect((await claimView(buyerCookie, claimId)).claim['provider_contact_note']).toBeNull();
    // funded through the normal verification path.
    depositEvents.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: SLOT_PRICE,
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      blockNumber: 100,
    });
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
    expect((verify.json() as { data: { status: string } }).data.status).toBe('funded');
    expect((await claimView(buyerCookie, claimId)).claim['provider_contact_note']).toBe(NOTE);
    // delivered through the normal provider path.
    const delivered = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/mark-delivered`,
      headers: { cookie: providerCookie, ...CSRF },
      payload: { providerPayoutAddress: PAYOUT },
    });
    expect(delivered.statusCode).toBe(200);
    expect((await claimView(buyerCookie, claimId)).claim['provider_contact_note']).toBe(NOTE);
    // disputed through the normal buyer path (Disputed event visible).
    disputeEvents.set(onChainEscrowId.toLowerCase(), {
      escrowId: onChainEscrowId,
      participant: '0x9999999999999999999999999999999999999999',
      amountBaseUnits: null,
      txHash: freshTxHash(),
      blockNumber: 101,
    });
    const dispute = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/dispute`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect((dispute.json() as { data: { status: string } }).data.status).toBe('disputed');
    expect((await claimView(buyerCookie, claimId)).claim['provider_contact_note']).toBe(NOTE);
    // Transitional and terminal states via direct row updates (gate reads
    // the status only; receipts stay null so nothing advances mid-read).
    // Both buyer surfaces are asserted at every step (escrow-view parity).
    for (const [status, expected, txField] of [
      ['releasing', NOTE, 'releaseTxHash'],
      ['released', NOTE, undefined],
      ['refunding', null, 'refundTxHash'],
      ['refunded', null, undefined],
    ] as const) {
      await setEscrowStatus(claimId, status, txField);
      const seen = await claimView(buyerCookie, claimId);
      expect(seen.status).toBe(200);
      expect(seen.claim['provider_contact_note']).toBe(expected);
      const escrowSeen = await escrowViews(buyerCookie, claimId);
      expect(escrowSeen.status).toBe(200);
      expect(escrowSeen.claim['provider_contact_note']).toBe(expected);
    }
  });

  it('escrow-view parity: buyer gated, provider null, list views lean', { timeout: 120_000 }, async () => {
    const { buyerCookie, providerCookie, claimId } = await noteSetup();
    await fundClaim(buyerCookie, claimId);
    // Buyer escrow view carries the gated note; the escrow object itself
    // never carries the field.
    const buyerFunded = await escrowViews(buyerCookie, claimId);
    expect(buyerFunded.status).toBe(200);
    expect(buyerFunded.claim['provider_contact_note']).toBe(NOTE);
    expect(buyerFunded.escrow).not.toHaveProperty('provider_contact_note');
    // Provider escrow view carries null regardless of escrow state.
    const providerFunded = await escrowViews(providerCookie, claimId);
    expect(providerFunded.status).toBe(200);
    expect(providerFunded.claim['provider_contact_note']).toBeNull();
    // After a direct refunded flip, the buyer view hides it too.
    await setEscrowStatus(claimId, 'refunded');
    const buyerRefunded = await escrowViews(buyerCookie, claimId);
    expect(buyerRefunded.status).toBe(200);
    expect(buyerRefunded.claim['provider_contact_note']).toBeNull();
    // List views stay lean: the buyer list carries the uniform ClaimView
    // shape with a null note (same null-carrying precedent as
    // resolution_notes on the buyer escrow view) — never the note text.
    const mine = await app.inject({ method: 'GET', url: '/api/v1/me/claims', headers: { cookie: buyerCookie } });
    expect(mine.statusCode).toBe(200);
    for (const item of (mine.json() as { data: { claims: Record<string, unknown>[] } }).data.claims) {
      expect(item['provider_contact_note']).toBeNull();
    }
    // The provider demand list is a different projection that lacks the
    // field entirely.
    const demand = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${(await claimSlotId(claimId))}/claims`,
      headers: { cookie: providerCookie },
    });
    expect(demand.statusCode).toBe(200);
    for (const item of (demand.json() as { data: { claims: Record<string, unknown>[] } }).data.claims) {
      expect(item).not.toHaveProperty('provider_contact_note');
    }

    async function claimSlotId(id: string): Promise<string> {
      const db = getDb();
      const rows = await db.select({ slotId: claims.slotId }).from(claims).where(eq(claims.id, id)).limit(1);
      if (!rows[0]) throw new Error('expected claim row');
      return rows[0].slotId;
    }
  });
});
