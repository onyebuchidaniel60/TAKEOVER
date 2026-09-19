// Integration tests — live DB. Provider demand views (truncated
// buyer identifiers only), display-name profiles, and providerDisplay on
// slot detail. Auth via the real challenge/verify flow with an injected
// signature stub. No payment_intent or tx data is ever asserted here beyond
// proving its absence from provider responses.
import { afterAll, describe, expect, it, vi } from 'vitest';

// Determinism: live-DB chains (login + mutations + verification
// reads) measure 2-5s per test against remote Postgres with spikes past 5s;
// observed failures were wall-clock timeouts only, scattered across tests
// and runs, never wrong values. File-level budget per the claims.test.ts
// precedent - not a logic fix.
vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress, truncateWalletAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, paymentIntents, providerProfiles, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('provider dashboards (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      // Budgets disabled here (proven separately in security.test.ts).
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerProfile: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];

  // Completion (F4): the CSRF guard requires an allowlisted Origin
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
    const { id: providerId } = await providerLogin();
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `P9 ${tag} slot`,
      description: `P9 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: 6,
      availableQuantity: 6,
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

  async function submitAs(cookie: string, claimId: string): Promise<string> {
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
    return hash;
  }

  // One shared provider for the file: a REAL derived wallet (fixture-style
  // `NQ00 …` addresses fail auth canonicalization, so they can own rows but
  // never log in — the provider here must do both).
  let provider: { wallet: string; cookie: string; id: string } | null = null;

  async function providerLogin(): Promise<{ cookie: string; wallet: string; id: string }> {
    if (provider) {
      return provider;
    }
    const db = getDb();
    const wallet = deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
    wallets.push(wallet);
    await db.insert(users).values({ walletAddress: wallet, role: 'buyer' }).onConflictDoNothing();
    const cookie = await loginAs(wallet);
    const id = await userIdFor(wallet);
    provider = { wallet, cookie, id };
    return provider;
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
        // Audit rows reference their actor: remove them first.
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(providerProfiles).where(inArray(providerProfiles.userId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('lists own slot claims with counts and truncated buyers', { timeout: 30_000 }, async () => {
    const { cookie } = await providerLogin();
    const slotId = await makeSlot();
    const buyerWallet = randomWallet();
    const buyerCookie = await loginAs(buyerWallet);
    await claimAs(buyerCookie, slotId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claims: Record<string, unknown>[]; counts: Record<string, number> };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.claims).toHaveLength(1);
    expect(Object.keys(body.data.claims[0] ?? {}).sort()).toEqual(
      ['buyerDisplay', 'claimed_at', 'hold_expires_at', 'id', 'quantity', 'status', 'updated_at'].sort(),
    );
    expect(body.data.claims[0]?.['buyerDisplay']).toBe(truncateWalletAddress(buyerWallet));
    expect(body.data.claims[0]?.['status']).toBe('active_hold');
    expect(body.data.counts).toEqual({
      active_hold: 1,
      expired: 0,
      deposit_submitted: 0,
      payment_pending: 0,
      paid: 0,
      payment_review: 0,
      cancelled: 0,
      escrow_funded: 0,
      delivered: 0,
      disputed: 0,
      released: 0,
      refunded: 0,
    });
  });

  it('counts every status bucket and sums to the array length', { timeout: 120_000 }, async () => {
    const db = getDb();
    const { cookie } = await providerLogin();
    // Twelve buyers, one claim each — slot sized so every hold succeeds.
    const now = Date.now();
    const { id: providerId } = await providerLogin();
    const bigSlotId = randomUUID();
    await db.insert(slots).values({
      id: bigSlotId,
      providerId,
      title: `P9 ${tag} twelve-slot`,
      description: `P9 ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: 20,
      availableQuantity: 20,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(bigSlotId);
    // Six buyers, one live claim each (creation order retained — no reliance
    // on unspecified SELECT order below).
    const held: { claimId: string; cookie: string }[] = [];
    for (let i = 0; i < 12; i += 1) {
      const wallet = randomWallet();
      const buyerCookie = await loginAs(wallet);
      held.push({ claimId: await claimAs(buyerCookie, bigSlotId), cookie: buyerCookie });
    }
    // [0] stays active_hold; [1] submits to payment_pending; the rest are
    // forced to the remaining statuses (read-shape test — transitions owned
    // by their own phases).
    const pending = held[1];
    if (!pending) throw new Error('expected twelve holds');
    await submitAs(pending.cookie, pending.claimId);
    const forced = [
      'deposit_submitted',
      'paid',
      'payment_review',
      'expired',
      'cancelled',
      'escrow_funded',
      'delivered',
      'disputed',
      'released',
      'refunded',
    ] as const;
    for (let i = 0; i < forced.length; i += 1) {
      const target = held[i + 2];
      if (!target) throw new Error('expected twelve holds');
      await db.update(claims).set({ status: forced[i] }).where(eq(claims.id, target.claimId));
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${bigSlotId}/claims`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claims: Record<string, unknown>[]; counts: Record<string, number> };
    };
    expect(body.data.claims).toHaveLength(12);
    expect(body.data.counts).toEqual({
      active_hold: 1,
      expired: 1,
      deposit_submitted: 1,
      payment_pending: 1,
      paid: 1,
      payment_review: 1,
      cancelled: 1,
      escrow_funded: 1,
      delivered: 1,
      disputed: 1,
      released: 1,
      refunded: 1,
    });
    const total = Object.values(body.data.counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(body.data.claims.length);
  });

  it('counts escrow-lifecycle claims alongside legacy ones', { timeout: 60_000 }, async () => {
    const db = getDb();
    const { cookie } = await providerLogin();
    const slotId = await makeSlot();
    const wanted = ['escrow_funded', 'delivered', 'released'] as const;
    for (const status of wanted) {
      const buyerCookie = await loginAs(randomWallet());
      const claimId = await claimAs(buyerCookie, slotId);
      await db.update(claims).set({ status }).where(eq(claims.id, claimId));
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { claims: Record<string, unknown>[]; counts: Record<string, number> };
    };
    expect(body.data.claims).toHaveLength(3);
    expect(body.data.counts).toEqual({
      active_hold: 0,
      expired: 0,
      deposit_submitted: 0,
      payment_pending: 0,
      paid: 0,
      payment_review: 0,
      cancelled: 0,
      escrow_funded: 1,
      delivered: 1,
      disputed: 0,
      released: 1,
      refunded: 0,
    });
  });

  it('never exposes full wallets, tx hashes, or intent fields to the provider', { timeout: 30_000 }, async () => {
    const { cookie } = await providerLogin();
    const slotId = await makeSlot();
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const wallet = randomWallet();
      seen.push(wallet);
      const buyerCookie = await loginAs(wallet);
      const claimId = await claimAs(buyerCookie, slotId);
      await submitAs(buyerCookie, claimId);
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const payload = JSON.stringify(res.json());
    for (const wallet of seen) {
      expect(payload.includes(wallet)).toBe(false);
    }
    for (const banned of [
      'txHash',
      'tx_hash',
      'expectedAmountNim',
      'expectedRecipient',
      'expectedSender',
      'expectedData',
      'expected_data',
      'submittedAt',
      'verifiedAt',
      'buyer_id',
      'slot_id',
      'proof',
      'signature',
    ]) {
      expect(payload.includes(`"${banned}"`)).toBe(false);
    }
  });

  it('returns 404 for non-owners and 401 without auth', { timeout: 30_000 }, async () => {
    await providerLogin();
    const slotId = await makeSlot();
    const stranger = await loginAs(randomWallet());
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie: stranger, ...CSRF },
    });
    expect(foreign.statusCode).toBe(404);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/me/slots/${slotId}/claims` });
    expect(anon.statusCode).toBe(401);
  });

  it('creates a provider profile when absent', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Sunrise Yoga' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { providerProfile: { displayName: string } } };
    expect(body.data.providerProfile).toEqual({ displayName: 'Sunrise Yoga' });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, ...CSRF } });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as {
      data: { user: { hasProviderProfile: boolean; providerProfile: { displayName: string } | null } };
    };
    expect(meBody.data.user.hasProviderProfile).toBe(true);
    expect(meBody.data.user.providerProfile).toEqual({ displayName: 'Sunrise Yoga' });
  });

  it('updates an existing profile and repeats idempotently', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'First Name' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Second Name' },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { providerProfile: { displayName: string } } }).data.providerProfile).toEqual({
      displayName: 'Second Name',
    });
    const repeat = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Second Name' },
    });
    expect(repeat.statusCode).toBe(200);
    expect((repeat.json() as { data: { providerProfile: { displayName: string } } }).data.providerProfile).toEqual({
      displayName: 'Second Name',
    });
  });

  it('rejects invalid display names with 400', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    for (const displayName of ['', 'A', 'x'.repeat(61), '   ', 'see https://x.io', 'go www.x.io']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/provider-profile',
        headers: { cookie, ...CSRF },
        payload: { display_name: displayName },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    }
  });

  it('returns providerProfile null when absent', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, ...CSRF } });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      data: { user: { hasProviderProfile: boolean; providerProfile: null } };
    };
    expect(body.data.user.hasProviderProfile).toBe(false);
    expect(body.data.user.providerProfile).toBeNull();
  });

  it('shows the display name on public slot detail when present', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Café Corner' },
    });
    const db = getDb();
    const providerId = await userIdFor(wallet);
    const now = Date.now();
    const slotId = randomUUID();
    await db.insert(slots).values({
      id: slotId,
      providerId,
      title: `P9 ${tag} named slot`,
      description: null,
      category: null,
      locationLabel: null,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: null,
      priceUsdt: 150000n,
      totalQuantity: 2,
      availableQuantity: 2,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(slotId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['providerDisplay']).toBe('Café Corner');
  });

  it('falls back to the truncated wallet without a profile', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    await loginAs(wallet);
    const db = getDb();
    const providerId = await userIdFor(wallet);
    const now = Date.now();
    const slotId = randomUUID();
    await db.insert(slots).values({
      id: slotId,
      providerId,
      title: `P9 ${tag} anonymous slot`,
      description: null,
      category: null,
      locationLabel: null,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: null,
      priceUsdt: 150000n,
      totalQuantity: 2,
      availableQuantity: 2,
      payoutWallet: validPayout(),
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(slotId);
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['providerDisplay']).toBe(truncateWalletAddress(wallet));
  });

  it('includes providerDisplay on the owner projection', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Owner Name' },
    });
    const db = getDb();
    const providerId = await userIdFor(wallet);
    const now = Date.now();
    const slotId = randomUUID();
    await db.insert(slots).values({
      id: slotId,
      providerId,
      title: `P9 ${tag} draft slot`,
      description: null,
      category: null,
      locationLabel: null,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: null,
      priceUsdt: 150000n,
      totalQuantity: 2,
      availableQuantity: 2,
      payoutWallet: validPayout(),
      status: 'draft',
      publishedAt: null,
    });
    slotIds.push(slotId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/slots/${slotId}`,
      headers: { cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> } };
    expect(body.data.slot['providerDisplay']).toBe('Owner Name');
    expect(body.data.slot).not.toHaveProperty('payout_wallet');
  });
});
