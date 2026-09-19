// End-to-end acceptance journey — live DB, ONE continuous test
// covering the PROJECT_SPEC.md s6 acceptance baseline through the real API:
// provider publishes → anonymous browses → buyer claims → pays (mocked RPC
// with a structurally correct tx; no live chain verification) →
// paid → provider sees it → audit trail in order.
//
// Programmatic E2E by locked decision (no browser automation; browser E2E is
// out of scope): real HTTP against the real app + real DB. Authentication uses
// REAL @nimiq/core signatures (the oracle pattern — no stub here),
// so this test also proves the production verifier inside the full journey.
// The CSRF Origin/header pair is sent on every credentialed mutation, exactly
// as the web client does.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { BufferUtils, Hash, KeyPair, Signature } from '@nimiq/core';
import { buildApp } from '../src/app';
import { canonicalizeNimiqAddress } from '../src/auth/nimiq-address';
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

// Journey budget: ~20 sequential live round trips against remote Postgres.
// Proportional to the workload (established precedent), not a flake fix.
vi.setConfig({ testTimeout: 180000 });

// Official Hub envelope prefix, 0x16 + 'Nimiq Signed Message:\n' (23 bytes,
// pinned byte-for-byte in test/nimiq-oracle.test.ts).
const HUB_PREFIX = `${String.fromCharCode(0x16)}Nimiq Signed Message:\n`;

describe.skipIf(!isDatabaseConfigured())('acceptance journey (live, real signatures)', () => {
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
      admin: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;

  // Completion (F4): credentialed mutations carry both signals.
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  function makeWallet(): { wallet: string; kp: ReturnType<typeof KeyPair.generate> } {
    const kp = KeyPair.generate();
    const wallet = canonicalizeNimiqAddress(kp.publicKey.toAddress().toUserFriendlyAddress());
    wallets.push(wallet);
    return { wallet, kp };
  }

  /** Real login: challenge from the server, signed by the @nimiq/core key. */
  async function loginReal(
    wallet: string,
    kp: ReturnType<typeof KeyPair.generate>,
  ): Promise<{ cookie: string; userId: string }> {
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { challenge: message, nonce } = (
      challenge.json() as { data: { challenge: string; nonce: string } }
    ).data;
    const data = BufferUtils.fromUtf8(HUB_PREFIX + message.length + message);
    const hash = Hash.computeSha256(data);
    const sig = Signature.create(kp.privateKey, kp.publicKey, hash);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: {
        walletAddress: wallet,
        nonce,
        signature: Buffer.from(sig.serialize()).toString('hex'),
        publicKey: Buffer.from(kp.publicKey.serialize()).toString('hex'),
      },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { data: { user: { id: string; walletAddress: string } } };
    expect(body.data.user.walletAddress).toBe(wallet);
    return { cookie: sessionCookieFrom(verify), userId: body.data.user.id };
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      const foundClaims = await db
        .select({ id: claims.id })
        .from(claims)
        .where(inArray(claims.slotId, slotIds));
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

  it('buyer journey: publish → browse → claim → pay → verify → paid → provider sees it → audit order', async () => {
    // 1. Provider authenticates with a real wallet signature.
    const provider = makeWallet();
    const session = await loginReal(provider.wallet, provider.kp);
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/);

    // 2. Provider creates a draft slot (single unit, own wallet as payout).
    const now = Date.now();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie: session.cookie, ...CSRF },
      payload: {
        title: `E2E ${tag} table for two`,
        description: `E2E ${tag} last-minute table`,
        category: 'dining',
        location_label: 'Mitte',
        starts_at: new Date(now + 2 * HOUR).toISOString(),
        ends_at: new Date(now + 4 * HOUR).toISOString(),
        price_usdt: '150000',
        total_quantity: 1,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { data: { slot: Record<string, unknown> } }).data.slot;
    expect(created['status']).toBe('draft');
    expect(created['available_quantity']).toBe(1);
    expect(created['total_quantity']).toBe(1);
    // Created without a payout wallet: the NIM-era field is gone from
    // creation and from the owner projection.
    expect(created).not.toHaveProperty('payout_wallet');
    const slotId = created['id'] as string;
    slotIds.push(slotId);
    // Legacy-row backfill: creation no longer collects a payout wallet, but
    // this journey exercises the deprecated direct-payment flow, which reads
    // slots.payout_wallet. New slots carry NULL; historical rows carry the
    // provider wallet — backfill it so the deprecated leg stays covered.
    await getDb().update(slots).set({ payoutWallet: provider.wallet }).where(eq(slots.id, slotId));

    // 3. Provider publishes it.
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/publish`,
      headers: { cookie: session.cookie, ...CSRF },
    });
    expect(publish.statusCode).toBe(200);
    expect((publish.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');

    // 4. Anonymous user browses the marketplace and sees the slot (public-safe).
    const browse = await app.inject({ method: 'GET', url: '/api/v1/slots?limit=50' });
    expect(browse.statusCode).toBe(200);
    const listed = (browse.json() as { data: { slots: Record<string, unknown>[] } }).data.slots;
    const seen = listed.find((s) => s['id'] === slotId);
    expect(seen).toBeDefined();
    expect(seen?.['price_usdt']).toBe('150000');
    expect(seen?.['available_quantity']).toBe(1);
    expect(JSON.stringify(seen)).not.toContain('payout_wallet');

    // 5. Buyer authenticates with a different real wallet.
    const buyer = makeWallet();
    expect(buyer.wallet).not.toBe(provider.wallet);
    const buyerSession = await loginReal(buyer.wallet, buyer.kp);

    // 6. Buyer fetches the slot detail (full commercial terms, still public-safe).
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${slotId}`,
      headers: { cookie: buyerSession.cookie },
    });
    expect(detail.statusCode).toBe(200);
    const publicSlot = (detail.json() as { data: { slot: Record<string, unknown> } }).data.slot;
    expect(publicSlot['title']).toBe(`E2E ${tag} table for two`);
    expect(publicSlot['status']).toBe('published');
    expect(publicSlot['available_quantity']).toBe(1);
    expect(JSON.stringify(publicSlot)).not.toContain('payout_wallet');

    // 7. Buyer claims the final unit: hold created, inventory consumed.
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie: buyerSession.cookie, ...CSRF },
      payload: {},
    });
    expect(claimRes.statusCode).toBe(200);
    const claimed = (claimRes.json() as { data: { claim: Record<string, unknown>; slot: Record<string, unknown> } }).data;
    expect(claimed.claim['status']).toBe('active_hold');
    const holdMs =
      new Date(claimed.claim['hold_expires_at'] as string).getTime() -
      new Date(claimed.claim['claimed_at'] as string).getTime();
    expect(holdMs).toBeGreaterThanOrEqual(599_000);
    expect(holdMs).toBeLessThanOrEqual(601_000);
    expect(claimed.slot['available_quantity']).toBe(0);
    expect(claimed.slot['status']).toBe('sold_out');
    const claimId = claimed.claim['id'] as string;

    // 8. Buyer creates the payment intent: server-issued terms only.
    const intentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      headers: { cookie: buyerSession.cookie, ...CSRF },
      payload: {},
    });
    expect(intentRes.statusCode).toBe(200);
    const intent = (intentRes.json() as { data: { intent: Record<string, unknown> } }).data.intent;
    expect(intent['expectedAmountNim']).toBe('150000');
    expect(intent['expectedRecipient']).toBe(provider.wallet);
    expect(intent['expectedData']).toBe(`TAKEOVER:v1:${claimId}`);
    expect(intent['status']).toBe('created');

    // 9. Buyer submits a structurally valid tx hash (recorded, NOT verified yet).
    const hash = randomUUID().replace(/-/g, '');
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie: buyerSession.cookie, ...CSRF },
      payload: { txHash: hash },
    });
    expect(submit.statusCode).toBe(200);
    const submitted = submit.json() as { data: { intent: { status: string; txHash: string }; claim: { status: string } } };
    expect(submitted.data.intent.status).toBe('submitted');
    expect(submitted.data.intent.txHash.toLowerCase()).toBe(hash.toLowerCase());
    expect(submitted.data.claim.status).toBe('payment_pending');

    // 10. Verify-payment against a matching chain tx (5 confirmations) pays it.
    fake.txByHash.set(hash.toLowerCase(), {
      hash,
      sender: buyer.wallet,
      recipient: provider.wallet,
      value: '150000',
      data: `TAKEOVER:v1:${claimId}`,
      confirmations: 5,
      blockNumber: 1_999_990,
    });
    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-payment`,
      headers: { cookie: buyerSession.cookie, ...CSRF },
      payload: {},
    });
    expect(verify.statusCode).toBe(200);
    const verifiedBody = verify.json() as {
      data: { verification: { status: string }; intent: { status: string }; claim: { status: string } };
    };
    expect(verifiedBody.data.verification.status).toBe('verified');
    expect(verifiedBody.data.intent.status).toBe('verified');
    expect(verifiedBody.data.claim.status).toBe('paid');

    // 11. Final money states: claim paid, intent verified, inventory consumed.
    const claimGet = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/${claimId}`,
      headers: { cookie: buyerSession.cookie },
    });
    expect(claimGet.statusCode).toBe(200);
    expect((claimGet.json() as { data: { claim: { status: string } } }).data.claim.status).toBe('paid');
    const db = getDb();
    const intentRow = (await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1))[0];
    expect(intentRow?.status).toBe('verified');
    expect(intentRow?.txHash?.toLowerCase()).toBe(hash.toLowerCase());
    const slotRow = (await db.select().from(slots).where(eq(slots.id, slotId)).limit(1))[0];
    expect(slotRow?.availableQuantity).toBe(0);
    expect(slotRow?.status).toBe('sold_out');

    // 12. Provider sees the paid claim on the demand view (minimum-necessary fields).
    const demand = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie: session.cookie },
    });
    expect(demand.statusCode).toBe(200);
    const demandBody = demand.json() as { data: { claims: Record<string, unknown>[]; counts: Record<string, number> } };
    expect(demandBody.data.claims).toHaveLength(1);
    expect(demandBody.data.claims[0]?.['status']).toBe('paid');
    const serialized = JSON.stringify(demandBody.data);
    expect(serialized).not.toContain(buyer.wallet);
    expect(serialized).not.toContain('txHash');
    expect(serialized).not.toContain('expectedRecipient');

    // 13. Counts show exactly one paid claim and zeros elsewhere.
    // (the demand view buckets all 12 claim_status values.)
    expect(demandBody.data.counts).toEqual({
      active_hold: 0,
      expired: 0,
      deposit_submitted: 0,
      payment_pending: 0,
      paid: 1,
      payment_review: 0,
      cancelled: 0,
      escrow_funded: 0,
      delivered: 0,
      disputed: 0,
      released: 0,
      refunded: 0,
    });

    // 14. Audit trail contains exactly the journey events in order. Note the
    // chronology: the buyer's user.created fires at buyer login (step 5),
    // AFTER slot.published (step 3) — the brief's "user.created (x2)" is the
    // multiplicity of creations, ordered here by when each actually happens.
    const events = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(inArray(auditEvents.entityId, [session.userId, buyerSession.userId, slotId, claimId]))
      .orderBy(asc(auditEvents.createdAt));
    expect(events.map((e) => e.eventType)).toEqual([
      'user.created',
      'slot.published',
      'user.created',
      'claim.created',
      'payment.submitted',
      'payment.verified',
    ]);
  });
});
