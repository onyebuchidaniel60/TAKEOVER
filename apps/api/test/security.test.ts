// Phase 12 adversarial security suite — live DB, one test per
// ARCHITECTURE.md s16 threat-matrix row. Auth goes through the real
// challenge/verify flow with an injected signature stub (cryptography itself
// is proven by crypto.test.ts + the @nimiq/core oracle); chain reads use a
// mutable fake RPC client. Fresh fixtures per test keep the per-user report
// limiter and the per-claim verify limiter isolated.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { sessionCookieOptions } from '../src/auth/session';
import { getNimiqRpcUrl, RpcUnavailableError, type NimiqRpcClient, type TxRecord } from '../src/payments/rpc';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import {
  auditEvents,
  authChallenges,
  claims,
  paymentIntents,
  providerProfiles,
  reports,
  sessions,
  slots,
  users,
} from '../../../db/schema';

// Remote-Postgres latency: every test in this file gets a 30s budget
// (Phase 10 precedent — sequential live round trips exceed the 5s default).
vi.setConfig({ testTimeout: 30000 });

// Vitest runs with cwd = apps/api, so anchor source/dist scans there
// (the api tsconfig targets CommonJS, where import.meta is unavailable).
const API_SRC = resolve(process.cwd(), 'src');
const WEB_DIST = resolve(process.cwd(), '../../web/dist');

describe.skipIf(!isDatabaseConfigured())('phase 12 adversarial security pass (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const fake: {
    txByHash: Map<string, TxRecord>;
    failWithUnavailable: boolean;
    calls: string[];
  } = { txByHash: new Map(), failWithUnavailable: false, calls: [] };

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
    async getBalance(): Promise<string> {
      throw new Error('Not implemented in this fake.');
    },
  };

  // Shared app: every budget disabled (budgets are proven by the dedicated
  // brute-force tests below on tiny-limit instances).
  const app = buildApp({
    verifySignature: stubVerifier,
    rpcClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerProfile: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
      admin: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const reportIds: string[] = [];
  const HOUR = 3_600_000;

  // Phase 12 completion (F4): the CSRF guard requires an allowlisted Origin
  // and the client header on every credentialed mutation. The test allowlist
  // is the dev default (CORS_ORIGINS unset here).
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

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

  async function loginAs(wallet: string, target: FastifyInstance = app): Promise<string> {
    const challenge = await target.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const verify = await target.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(verify.statusCode).toBe(200);
    return sessionCookieFrom(verify);
  }

  async function loginAdmin(
    target: FastifyInstance = app,
  ): Promise<{ cookie: string; wallet: string; userId: string }> {
    const wallet = randomWallet();
    process.env.ADMIN_WALLET_ADDRESSES = wallet;
    try {
      const cookie = await loginAs(wallet, target);
      const db = getDb();
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
      if (!rows[0]) throw new Error('expected admin user row');
      return { cookie, wallet, userId: rows[0].id };
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
    overrides: {
      status?: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired';
      total?: number;
      available?: number;
    } = {},
  ): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const providerWallet = `NQ00 S12PROV${tag.toUpperCase()}`;
    if (!wallets.includes(providerWallet)) {
      wallets.push(providerWallet);
      await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    }
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `S12 ${tag} slot`,
      description: `S12 ${tag} description`,
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

  function validDraftBody(title: string): Record<string, unknown> {
    const now = Date.now();
    return {
      title,
      description: `S12 ${tag} description`,
      category: 'dining',
      location_label: 'Mitte',
      starts_at: new Date(now + 2 * HOUR).toISOString(),
      ends_at: new Date(now + 4 * HOUR).toISOString(),
      price_nim: '150000',
      total_quantity: 4,
      payout_wallet: validPayout(),
    };
  }

  async function claimAs(cookie: string, slotId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  async function intentAs(cookie: string, claimId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-intent`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  async function submitAs(cookie: string, claimId: string, txHash: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/payment-submission`,
      headers: { cookie, ...CSRF },
      payload: { txHash },
    });
  }

  async function verifyAs(cookie: string, claimId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-payment`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  /** Full payable setup: published slot, buyer hold, intent, submitted hash. */
  async function submittedClaim(
    buyerWallet?: string,
    buyerCookie?: string,
  ): Promise<{ wallet: string; cookie: string; slotId: string; claimId: string; hash: string }> {
    const wallet = buyerWallet ?? randomWallet();
    const cookie = buyerCookie ?? (await loginAs(wallet));
    const slotId = await makeSlot();
    const claimRes = await claimAs(cookie, slotId);
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const intentRes = await intentAs(cookie, claimId);
    expect(intentRes.statusCode).toBe(200);
    const hash = freshHash();
    const submitRes = await submitAs(cookie, claimId, hash);
    expect(submitRes.statusCode).toBe(200);
    return { wallet, cookie, slotId, claimId, hash };
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

  async function intentTerms(
    claimId: string,
  ): Promise<{ sender: string; recipient: string; amount: string; data: string }> {
    const db = getDb();
    const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.claimId, claimId)).limit(1);
    const intent = rows[0];
    if (!intent) throw new Error('expected intent row');
    return {
      sender: intent.expectedSender,
      recipient: intent.expectedRecipient,
      amount: intent.expectedAmountNim.toString(),
      data: intent.expectedData,
    };
  }

  afterAll(async () => {
    const db = getDb();
    if (reportIds.length > 0) {
      await db.delete(reports).where(inArray(reports.id, reportIds));
    }
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

  // -- authentication replay --------------------------------------------------

  it('auth replay: reusing a consumed nonce is rejected', async () => {
    const wallet = randomWallet();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(replay.statusCode).toBe(401);
    const body = replay.json() as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.requestId).toBe('string');
  });

  it('auth replay: an expired nonce is rejected', async () => {
    const wallet = randomWallet();
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    expect(challenge.statusCode).toBe(200);
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const db = getDb();
    await db
      .update(authChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authChallenges.nonce, nonce));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AUTH_EXPIRED');
  });

  // -- session theft ------------------------------------------------------------

  it('session theft: forged cookie (valid sessionId, wrong secret) is rejected', async () => {
    const cookie = await loginAs(randomWallet());
    const raw = cookie.slice('takeover_session='.length);
    const forged = `takeover_session=${raw.slice(0, raw.indexOf('.'))}.${'A'.repeat(43)}`;
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: forged, ...CSRF } });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('session theft: expired session is rejected', async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const userId = await userIdFor(wallet);
    const db = getDb();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, userId));
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, ...CSRF } });
    expect(res.statusCode).toBe(401);
  });

  it('session theft: revoked session (logout) is rejected', async () => {
    const cookie = await loginAs(randomWallet());
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, ...CSRF } });
    expect(logout.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, ...CSRF } });
    expect(res.statusCode).toBe(401);
  });

  // -- IDOR sweep -----------------------------------------------------------------

  it('idor: buyer B cannot read buyer A claim and anonymous cannot either', async () => {
    const cookieA = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimRes = await claimAs(cookieA, slotId);
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const cookieB = await loginAs(randomWallet());
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}`, headers: { cookie: cookieB, ...CSRF } });
    expect(foreign.statusCode).toBe(404);
    expect((foreign.json() as { error: { code: string } }).error.code).toBe('CLAIM_NOT_FOUND');
    const anon = await app.inject({ method: 'GET', url: `/api/v1/claims/${claimId}` });
    expect(anon.statusCode).toBe(401);
  });

  it('idor: buyer B cannot mint intent, submit, or verify on A claim', async () => {
    const cookieA = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const claimRes = await claimAs(cookieA, slotId);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const cookieB = await loginAs(randomWallet());
    expect((await intentAs(cookieB, claimId)).statusCode).toBe(404);
    expect((await submitAs(cookieB, claimId, freshHash())).statusCode).toBe(404);
    expect((await verifyAs(cookieB, claimId)).statusCode).toBe(404);
  });

  it('idor: provider B cannot patch, publish, or cancel A slot', async () => {
    const slotId = await makeSlot(validPayout(), { status: 'draft' });
    const cookieB = await loginAs(randomWallet());
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${slotId}`,
      headers: { cookie: cookieB, ...CSRF },
      payload: { title: 'hijacked' },
    });
    expect(patch.statusCode).toBe(404);
    const publish = await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/publish`, headers: { cookie: cookieB, ...CSRF } });
    expect(publish.statusCode).toBe(404);
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/cancel`, headers: { cookie: cookieB, ...CSRF } });
    expect(cancel.statusCode).toBe(404);
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.title).toBe(`S12 ${tag} slot`);
    expect(rows[0]?.status).toBe('draft');
  });

  it('idor: provider B cannot list A slot claims', async () => {
    const slotId = await makeSlot();
    const attacker = await loginAs(randomWallet());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie: attacker, ...CSRF },
    });
    expect(res.statusCode).toBe(404);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/me/slots/${slotId}/claims` });
    expect(anon.statusCode).toBe(401);
  });

  it('idor: non-owner never sees draft detail or the payout wallet', async () => {
    const slotId = await makeSlot(validPayout(), { status: 'draft' });
    const outsider = await loginAs(randomWallet());
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}`, headers: { cookie: outsider, ...CSRF } });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('payout_wallet');
    const anon = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(anon.statusCode).toBe(404);
    expect(JSON.stringify(anon.json())).not.toContain('payout_wallet');
  });

  it('idor: /me/slots and /me/claims isolate by owner', async () => {
    const cookieA = await loginAs(randomWallet());
    const create = await app.inject({ method: 'POST', url: '/api/v1/slots', headers: { cookie: cookieA, ...CSRF }, payload: validDraftBody(`S12 ${tag} isolation`) });
    expect(create.statusCode).toBe(201);
    const ownedId = (create.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(ownedId);
    const slotId = await makeSlot();
    const claimRes = await claimAs(cookieA, slotId);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const cookieB = await loginAs(randomWallet());
    const slotsB = await app.inject({ method: 'GET', url: '/api/v1/me/slots', headers: { cookie: cookieB, ...CSRF } });
    expect(slotsB.statusCode).toBe(200);
    const slotItems = (slotsB.json() as { data: { slots: { id: string }[] } }).data.slots;
    expect(slotItems.map((s) => s.id)).not.toContain(ownedId);
    const claimsB = await app.inject({ method: 'GET', url: '/api/v1/me/claims', headers: { cookie: cookieB, ...CSRF } });
    expect(claimsB.statusCode).toBe(200);
    const claimItems = (claimsB.json() as { data: { claims: { id: string }[] } }).data.claims;
    expect(claimItems.map((c) => c.id)).not.toContain(claimId);
  });

  // -- role forgery -----------------------------------------------------------------

  it('role forgery: role/admin fields in bodies and headers are ignored', async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const forgedCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: { ...validDraftBody(`S12 ${tag} roleforge`), role: 'admin' },
    });
    expect(forgedCreate.statusCode).toBe(400);
    const forgedProfile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: 'Honest Name', role: 'admin', verified: true },
    });
    expect(forgedProfile.statusCode).toBe(400);
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      payload: { walletAddress: wallet },
    });
    const { nonce } = (challenge.json() as { data: { nonce: string } }).data;
    const forgedVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { walletAddress: wallet, nonce, signature: 'sig', publicKey: 'key', role: 'admin' },
    });
    expect(forgedVerify.statusCode).toBe(400);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie, ...CSRF, 'x-role': 'admin', 'x-admin': 'true' },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { data: { user: { role: string } } }).data.user.role).not.toBe('admin');
  });

  // -- SQL injection ------------------------------------------------------------------

  it('sqli: wallet-shaped inputs reject injection payloads, tables intact', async () => {
    for (const evil of [`' OR '1'='1`, `'; DROP TABLE users; --`, `" OR ""="`]) {
      const challenge = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/challenge',
        payload: { walletAddress: evil },
      });
      expect(challenge.statusCode).toBe(400);
      const verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify',
        payload: { walletAddress: evil, nonce: 'a'.repeat(64), signature: 'sig' },
      });
      expect(verify.statusCode).toBe(400);
    }
    const db = getDb();
    const count = await db.select().from(users).limit(1);
    expect(Array.isArray(count)).toBe(true);
  });

  it('sqli: free-text fields store payloads verbatim without executing', async () => {
    const cookie = await loginAs(randomWallet());
    const evilTitle = `'; DROP TABLE slots; --`;
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: validDraftBody(evilTitle),
    });
    expect(create.statusCode).toBe(201);
    const createdId = (create.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(createdId);
    const evilName = `' OR '1'='1`;
    const profile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: evilName },
    });
    expect(profile.statusCode).toBe(200);
    expect((profile.json() as { data: { providerProfile: { displayName: string } } }).data.providerProfile.displayName).toBe(evilName);
    const slotId = await makeSlot();
    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie, ...CSRF },
      payload: { slotId, reason: 'other', details: `'; DROP TABLE reports; --` },
    });
    expect(report.statusCode).toBe(201);
    reportIds.push((report.json() as { data: { report: { id: string } } }).data.report.id);
    const db = getDb();
    expect((await db.select().from(slots).limit(1)).length).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(reports).limit(1)).length).toBeGreaterThanOrEqual(1);
    const stored = await db.select().from(slots).where(eq(slots.id, createdId)).limit(1);
    expect(stored[0]?.title).toBe(evilTitle);
  });

  it('sqli: tx hash and search params reject or escape payloads', async () => {
    const { cookie, claimId } = await submittedClaim();
    const evilHash = `ab'; DROP TABLE payment_intents; --`;
    const submit = await submitAs(cookie, claimId, evilHash);
    expect(submit.statusCode).toBe(400);
    const db = getDb();
    expect((await db.select().from(paymentIntents).limit(1)).length).toBeGreaterThanOrEqual(1);
    for (const q of [`' OR '1'='1`, `%`, `_`, `\\`, `'; DROP TABLE slots; --`]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/slots?q=${encodeURIComponent(q)}&limit=50` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { slots: unknown[]; total: number } };
      expect(body.data.total).toBe(0);
    }
    const cat = await app.inject({ method: 'GET', url: `/api/v1/slots?category=${encodeURIComponent(`' OR '1'='1`)}` });
    expect(cat.statusCode).toBe(200);
    expect((cat.json() as { data: { total: number } }).data.total).toBe(0);
  });

  // -- XSS (API side; render side lives in the web suite) ---------------------------------

  it('xss: API returns user markup as inert JSON, never rendered HTML', async () => {
    const cookie = await loginAs(randomWallet());
    const evilTitle = `<script>alert('xss')</script>`;
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: validDraftBody(evilTitle),
    });
    expect(create.statusCode).toBe(201);
    const createdId = (create.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(createdId);
    expect(create.headers['content-type']).toContain('application/json');
    const evilName = `<img src=x onerror=alert(1)>`;
    const profile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/provider-profile',
      headers: { cookie, ...CSRF },
      payload: { display_name: evilName },
    });
    expect(profile.statusCode).toBe(200);
    const raw = JSON.stringify(profile.json());
    expect(raw).toContain(evilName);
    expect(profile.headers['content-type']).toContain('application/json');
    const slotId = await makeSlot();
    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie, ...CSRF },
      payload: { slotId, reason: 'other', details: `javascript:alert(1)` },
    });
    expect(report.statusCode).toBe(201);
    reportIds.push((report.json() as { data: { report: { id: string } } }).data.report.id);
    expect((report.json() as { data: { report: { details: string } } }).data.report.details).toBe(`javascript:alert(1)`);
  });

  // -- CSRF -----------------------------------------------------------------------------------

  it('csrf: preflight from a non-allowlisted origin gets no ACAO header', async () => {
    const corsApp = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      corsOrigins: ['https://app.takeover.test'],
      rateLimit: {
        challenge: { windowMs: 60_000, max: 1000 },
        verify: { windowMs: 60_000, max: 1000 },
      },
    });
    try {
      const evil = await corsApp.inject({
        method: 'OPTIONS',
        url: `/api/v1/slots/${randomUUID()}/claims`,
        headers: {
          origin: 'https://evil.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
      const good = await corsApp.inject({
        method: 'OPTIONS',
        url: `/api/v1/slots/${randomUUID()}/claims`,
        headers: {
          origin: 'https://app.takeover.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(good.headers['access-control-allow-origin']).toBe('https://app.takeover.test');
      expect(good.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await corsApp.close();
    }
  });

  it('csrf: simple form POST with a valid cookie fails closed without mutation', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const db = getDb();
    const url = `/api/v1/slots/${slotId}/claims`;
    // Non-JSON bodies never reach the guard: no urlencoded parser exists, so
    // Fastify rejects them first — still fails closed with zero rows written.
    const form = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'quantity=1',
    });
    expect(form.statusCode).toBe(415);
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
    // JSON body without Origin: the guard rejects before any handler runs.
    const noOrigin = await app.inject({ method: 'POST', url, headers: { cookie }, payload: {} });
    expect(noOrigin.statusCode).toBe(403);
    expect((noOrigin.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN');
    // Allowlisted Origin but no custom header: still rejected.
    const noHeader = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: {},
    });
    expect(noHeader.statusCode).toBe(403);
    expect((noHeader.json() as { error: { code: string } }).error.code).toBe('MISSING_CLIENT_HEADER');
    // Both present: the one legitimate claim lands, exactly once.
    const ok = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, origin: 'http://localhost:5173', 'x-takeover-client': 'web' },
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(1);
    const slot = (await db.select().from(slots).where(eq(slots.id, slotId)).limit(1))[0];
    expect(slot?.availableQuantity).toBe((slot?.totalQuantity ?? 0) - 1);
  });

  // -- CSRF guard (Phase 12 completion, F4) ---------------------------------------------

  it('csrf guard: credentialed POST with no Origin is rejected', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe('FORBIDDEN_ORIGIN');
    expect(typeof body.requestId).toBe('string');
    const db = getDb();
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
  });

  it('csrf guard: credentialed POST from a disallowed Origin is rejected', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, origin: 'https://evil.test', 'x-takeover-client': 'web' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN');
    const db = getDb();
    expect(await db.select().from(claims).where(eq(claims.slotId, slotId))).toHaveLength(0);
  });

  it('csrf guard: credentialed POST with allowed Origin but no client header is rejected', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MISSING_CLIENT_HEADER');
    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, origin: 'http://localhost:5173', 'x-takeover-client': 'native' },
      payload: {},
    });
    expect(wrong.statusCode).toBe(403);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe('MISSING_CLIENT_HEADER');
  });

  it('csrf guard: credentialed POST with allowed Origin and client header succeeds', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, origin: 'http://localhost:5173', 'x-takeover-client': 'web' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { id: string } } }).data.claim.id).toBeDefined();
  });

  it('csrf guard: uncredentialed POST with a bad Origin is allowed through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      headers: { origin: 'https://evil.test' },
      payload: { walletAddress: randomWallet() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('csrf guard: GET with a bad Origin is allowed (idempotent)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/slots?limit=5',
      headers: { origin: 'https://evil.test' },
    });
    expect(res.statusCode).toBe(200);
  });

  // -- SSRF ------------------------------------------------------------------------------------

  it('ssrf: only the fixed RPC endpoint is ever fetched server-side', async () => {
    const fetchFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith('.ts') && readFileSync(full, 'utf8').includes('fetch(')) {
          fetchFiles.push(full);
        }
      }
    };
    walk(API_SRC);
    expect(fetchFiles.map((f) => f.replace(/\\/g, '/'))).toEqual([join(API_SRC, 'payments/rpc.ts').replace(/\\/g, '/')]);
    // The endpoint comes from env-or-default only: no request input in the signature path.
    expect(getNimiqRpcUrl({})).toBe('https://rpc.nimiqwatch.com');
    expect(getNimiqRpcUrl({ NIMIQ_RPC_URL: '  https://node.internal:8648  ' })).toBe('https://node.internal:8648');
    // A URL-shaped tx hash never reaches fetch: hex validation rejects it first.
    const before = fake.calls.length;
    const { cookie, claimId } = await submittedClaim();
    const res = await submitAs(cookie, claimId, 'http://evil.test/x');
    expect(res.statusCode).toBe(400);
    expect(fake.calls.length).toBe(before);
  });

  // -- brute force ----------------------------------------------------------------------------------

  it('brute force: auth challenge over budget returns 429', async () => {
    const tiny = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: { challenge: { windowMs: 60_000, max: 2 } },
    });
    try {
      for (let i = 0; i < 2; i += 1) {
        const res = await tiny.inject({
          method: 'POST',
          url: '/api/v1/auth/challenge',
          payload: { walletAddress: randomWallet() },
        });
        expect(res.statusCode).toBe(200);
      }
      const limited = await tiny.inject({
        method: 'POST',
        url: '/api/v1/auth/challenge',
        payload: { walletAddress: randomWallet() },
      });
      expect(limited.statusCode).toBe(429);
      const body = limited.json() as { error: { code: string }; requestId: string };
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(typeof body.requestId).toBe('string');
    } finally {
      await tiny.close();
    }
  });

  it('brute force: auth verify over budget returns 429', async () => {
    const tiny = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: { verify: { windowMs: 60_000, max: 2 } },
    });
    try {
      for (let i = 0; i < 2; i += 1) {
        await tiny.inject({
          method: 'POST',
          url: '/api/v1/auth/verify',
          payload: { walletAddress: randomWallet(), nonce: 'b'.repeat(64), signature: 'x' },
        });
      }
      const limited = await tiny.inject({
        method: 'POST',
        url: '/api/v1/auth/verify',
        payload: { walletAddress: randomWallet(), nonce: 'c'.repeat(64), signature: 'x' },
      });
      expect(limited.statusCode).toBe(429);
      expect((limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    } finally {
      await tiny.close();
    }
  });

  it('brute force: reports over budget return 429', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { cookie, ...CSRF },
        payload: { slotId, reason: 'other' },
      });
      expect(res.statusCode).toBe(201);
      reportIds.push((res.json() as { data: { report: { id: string } } }).data.report.id);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { cookie, ...CSRF },
      payload: { slotId, reason: 'other' },
    });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe('REPORT_RATE_LIMITED');
  }, 30000);

  it('brute force: verify-payment over budget returns 429 with retry-after', async () => {
    const { cookie, claimId, hash } = await submittedClaim();
    // No fake tx seeded: the hash is absent on chain, so verification stays pending.
    fake.txByHash.delete(hash.toLowerCase());
    const first = await verifyAs(cookie, claimId);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { verification: { status: string } } }).data.verification.status).toBe('pending');
    const limited = await verifyAs(cookie, claimId);
    expect(limited.statusCode).toBe(429);
    const body = limited.json() as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe('VERIFY_RATE_LIMITED');
    expect(typeof body.requestId).toBe('string');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('brute force: new mutating budgets trip cleanly', async () => {
    // Claim creation per-IP.
    const claimApp = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: {
        challenge: { windowMs: 60_000, max: 1000 },
        verify: { windowMs: 60_000, max: 1000 },
        claimCreate: { windowMs: 60_000, max: 2 },
      },
    });
    try {
      const slotId = await makeSlot();
      for (let i = 0; i < 2; i += 1) {
        const res = await claimApp.inject({
          method: 'POST',
          url: `/api/v1/slots/${slotId}/claims`,
          headers: { cookie: await loginAs(randomWallet(), claimApp), ...CSRF },
          payload: {},
        });
        expect(res.statusCode).toBe(200);
      }
      const limited = await claimApp.inject({
        method: 'POST',
        url: `/api/v1/slots/${slotId}/claims`,
        headers: { cookie: await loginAs(randomWallet(), claimApp), ...CSRF },
        payload: {},
      });
      expect(limited.statusCode).toBe(429);
      expect((limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    } finally {
      await claimApp.close();
    }

    // Slot creation per-user: the same account trips it, another account does not.
    const slotApp = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: {
        challenge: { windowMs: 60_000, max: 1000 },
        verify: { windowMs: 60_000, max: 1000 },
        slotCreate: { windowMs: 3_600_000, max: 2 },
      },
    });
    try {
      const cookie = await loginAs(randomWallet(), slotApp);
      for (let i = 0; i < 2; i += 1) {
        const res = await slotApp.inject({
          method: 'POST',
          url: '/api/v1/slots',
          headers: { cookie, ...CSRF },
          payload: validDraftBody(`S12 ${tag} spam ${i}`),
        });
        expect(res.statusCode).toBe(201);
        slotIds.push((res.json() as { data: { slot: { id: string } } }).data.slot.id);
      }
      const limited = await slotApp.inject({
        method: 'POST',
        url: '/api/v1/slots',
        headers: { cookie, ...CSRF },
        payload: validDraftBody(`S12 ${tag} spam 3`),
      });
      expect(limited.statusCode).toBe(429);
      const other = await slotApp.inject({
        method: 'POST',
        url: '/api/v1/slots',
        headers: { cookie: await loginAs(randomWallet(), slotApp), ...CSRF },
        payload: validDraftBody(`S12 ${tag} other user`),
      });
      expect(other.statusCode).toBe(201);
      slotIds.push((other.json() as { data: { slot: { id: string } } }).data.slot.id);
    } finally {
      await slotApp.close();
    }

    // Owner mutations, provider profile, and admin backstop.
    const mutateApp = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: {
        challenge: { windowMs: 60_000, max: 1000 },
        verify: { windowMs: 60_000, max: 1000 },
        slotCreate: { windowMs: 3_600_000, max: 1000 },
        slotMutate: { windowMs: 60_000, max: 2 },
        providerProfile: { windowMs: 60_000, max: 2 },
        admin: { windowMs: 60_000, max: 2 },
      },
    });
    try {
      const cookie = await loginAs(randomWallet(), mutateApp);
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await mutateApp.inject({
          method: 'POST',
          url: '/api/v1/slots',
          headers: { cookie, ...CSRF },
          payload: validDraftBody(`S12 ${tag} mutate ${i}`),
        });
        expect(res.statusCode).toBe(201);
        const id = (res.json() as { data: { slot: { id: string } } }).data.slot.id;
        ids.push(id);
        slotIds.push(id);
      }
      expect((await mutateApp.inject({ method: 'POST', url: `/api/v1/slots/${ids[0]}/publish`, headers: { cookie, ...CSRF } })).statusCode).toBe(200);
      expect((await mutateApp.inject({ method: 'POST', url: `/api/v1/slots/${ids[1]}/publish`, headers: { cookie, ...CSRF } })).statusCode).toBe(200);
      const mutateLimited = await mutateApp.inject({ method: 'POST', url: `/api/v1/slots/${ids[2]}/publish`, headers: { cookie, ...CSRF } });
      expect(mutateLimited.statusCode).toBe(429);
      for (let i = 0; i < 2; i += 1) {
        const res = await mutateApp.inject({
          method: 'PATCH',
          url: '/api/v1/me/provider-profile',
          headers: { cookie, ...CSRF },
          payload: { display_name: `Profile Name ${i}` },
        });
        expect(res.statusCode).toBe(200);
      }
      const profileLimited = await mutateApp.inject({
        method: 'PATCH',
        url: '/api/v1/me/provider-profile',
        headers: { cookie, ...CSRF },
        payload: { display_name: 'Third Name' },
      });
      expect(profileLimited.statusCode).toBe(429);
      const { cookie: adminCookie } = await loginAdmin(mutateApp);
      expect((await mutateApp.inject({ method: 'GET', url: '/api/v1/admin/reports', headers: { cookie: adminCookie, ...CSRF } })).statusCode).toBe(200);
      expect((await mutateApp.inject({ method: 'GET', url: '/api/v1/admin/reports', headers: { cookie: adminCookie, ...CSRF } })).statusCode).toBe(200);
      const adminLimited = await mutateApp.inject({ method: 'GET', url: '/api/v1/admin/reports', headers: { cookie: adminCookie, ...CSRF } });
      expect(adminLimited.statusCode).toBe(429);
    } finally {
      await mutateApp.close();
    }
  }, 30000);

  // -- payment manipulation --------------------------------------------------------------

  it('payment replay: the same tx hash cannot settle two claims', async () => {
    const buyerA = randomWallet();
    const cookieA = await loginAs(buyerA);
    const buyerB = randomWallet();
    const cookieB = await loginAs(buyerB);
    const slotA = await makeSlot();
    const slotB = await makeSlot();
    const claimA = (await claimAs(cookieA, slotA)).json() as { data: { claim: { id: string } } };
    const claimB = (await claimAs(cookieB, slotB)).json() as { data: { claim: { id: string } } };
    expect((await intentAs(cookieA, claimA.data.claim.id)).statusCode).toBe(200);
    expect((await intentAs(cookieB, claimB.data.claim.id)).statusCode).toBe(200);
    const hash = freshHash();
    expect((await submitAs(cookieA, claimA.data.claim.id, hash)).statusCode).toBe(200);
    const replay = await submitAs(cookieB, claimB.data.claim.id, hash);
    expect(replay.statusCode).toBe(409);
    expect((replay.json() as { error: { code: string } }).error.code).toBe('PAYMENT_ALREADY_SUBMITTED');
    // The second claim is still payable with its own transaction.
    expect((await submitAs(cookieB, claimB.data.claim.id, freshHash())).statusCode).toBe(200);
  }, 30000);

  it('amount manipulation: wrong amount goes to review, never paid', async () => {
    const { cookie, claimId, hash } = await submittedClaim();
    const terms = await intentTerms(claimId);
    const wrongAmount = (BigInt(terms.amount) + 1n).toString();
    fake.txByHash.set(hash.toLowerCase(), matchingTx({ hash, ...terms, value: wrongAmount }));
    try {
      const res = await verifyAs(cookie, claimId);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { claim: { status: string }; verification: { status: string; reason: string } } };
      expect(body.data.verification.status).toBe('review');
      expect(body.data.verification.reason).toBe('amount_mismatch');
      expect(body.data.claim.status).toBe('payment_review');
    } finally {
      fake.txByHash.delete(hash.toLowerCase());
    }
  });

  it('recipient manipulation: payout wallet is immutable after publish', async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const payout = validPayout();
    const body = { ...validDraftBody(`S12 ${tag} immutable`), payout_wallet: payout };
    const create = await app.inject({ method: 'POST', url: '/api/v1/slots', headers: { cookie, ...CSRF }, payload: body });
    expect(create.statusCode).toBe(201);
    const slotId = (create.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(slotId);
    expect((await app.inject({ method: 'POST', url: `/api/v1/slots/${slotId}/publish`, headers: { cookie, ...CSRF } })).statusCode).toBe(200);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${slotId}`,
      headers: { cookie, ...CSRF },
      payload: { payout_wallet: validPayout() },
    });
    expect(patch.statusCode).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe('SLOT_NOT_EDITABLE');
    const db = getDb();
    const stored = (await db.select().from(slots).where(eq(slots.id, slotId)).limit(1))[0];
    expect(stored?.payoutWallet).toBe(payout);
    const buyerCookie = await loginAs(randomWallet());
    const claimRes = await claimAs(buyerCookie, slotId);
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const intent = await intentAs(buyerCookie, claimId);
    expect(intent.statusCode).toBe(200);
    expect((intent.json() as { data: { intent: { expectedRecipient: string } } }).data.intent.expectedRecipient).toBe(payout);
  });

  it('sender spoofing: tx from a different sender goes to review', async () => {
    const { cookie, claimId, hash } = await submittedClaim();
    const terms = await intentTerms(claimId);
    fake.txByHash.set(hash.toLowerCase(), matchingTx({ hash, ...terms, sender: validPayout() }));
    try {
      const res = await verifyAs(cookie, claimId);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { verification: { status: string; reason: string } } };
      expect(body.data.verification.status).toBe('review');
      expect(body.data.verification.reason).toBe('sender_mismatch');
    } finally {
      fake.txByHash.delete(hash.toLowerCase());
    }
  });

  it('transaction-data spoofing: correct triple with wrong data goes to review', async () => {
    const { cookie, claimId, hash } = await submittedClaim();
    const terms = await intentTerms(claimId);
    fake.txByHash.set(hash.toLowerCase(), matchingTx({ hash, ...terms, data: 'TAKEOVER:v1:00000000-0000-4000-8000-000000000000' }));
    try {
      const res = await verifyAs(cookie, claimId);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { verification: { status: string; reason: string } } };
      expect(body.data.verification.status).toBe('review');
      expect(body.data.verification.reason).toBe('data_mismatch');
    } finally {
      fake.txByHash.delete(hash.toLowerCase());
    }
  });

  // -- secret hygiene --------------------------------------------------------------------------

  it('secret hygiene: every error envelope carries requestId and leaks nothing', async () => {
    const buyerCookie = await loginAs(randomWallet());
    const draft = await app.inject({ method: 'POST', url: '/api/v1/slots', headers: { cookie: buyerCookie, ...CSRF }, payload: validDraftBody(`S12 ${tag} errscan`) });
    expect(draft.statusCode).toBe(201);
    const draftId = (draft.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(draftId);
    expect((await app.inject({ method: 'POST', url: `/api/v1/slots/${draftId}/publish`, headers: { cookie: buyerCookie, ...CSRF } })).statusCode).toBe(200);

    const tiny = buildApp({
      verifySignature: stubVerifier,
      rpcClient,
      rateLimit: { challenge: { windowMs: 60_000, max: 1 } },
    });
    try {
      await tiny.inject({ method: 'POST', url: '/api/v1/auth/challenge', payload: { walletAddress: randomWallet() } });
      const rateLimited = await tiny.inject({ method: 'POST', url: '/api/v1/auth/challenge', payload: { walletAddress: randomWallet() } });
      expect(rateLimited.statusCode).toBe(429);

      const failingRpc: NimiqRpcClient = {
        async getTransactionByHash(): Promise<TxRecord | null> {
          throw new RpcUnavailableError('down');
        },
        async getBlockNumber(): Promise<number> {
          throw new RpcUnavailableError('down');
        },
        async getBalance(): Promise<string> {
          throw new RpcUnavailableError('down');
        },
      };
      const downApp = buildApp({
        verifySignature: stubVerifier,
        rpcClient: failingRpc,
        rateLimit: {
          challenge: { windowMs: 60_000, max: 1000 },
          verify: { windowMs: 60_000, max: 1000 },
          intent: { windowMs: 60_000, max: 1000 },
          submission: { windowMs: 60_000, max: 1000 },
          claimCreate: { windowMs: 60_000, max: 1000 },
        },
      });
      let rpcDown: InjectResponse;
      try {
        const w = randomWallet();
        const c = await loginAs(w, downApp);
        const db = getDb();
        const now = Date.now();
        const providerWallet = `NQ00 S12PROV${tag.toUpperCase()}`;
        const providerId = await userIdFor(providerWallet);
        const doomedSlot = randomUUID();
        await db.insert(slots).values({
          id: doomedSlot,
          providerId,
          title: `S12 ${tag} doomed`,
          description: null,
          category: null,
          locationLabel: null,
          startsAt: new Date(now + 2 * HOUR),
          endsAt: null,
          priceNim: 150000n,
          totalQuantity: 1,
          availableQuantity: 1,
          payoutWallet: validPayout(),
          status: 'published',
          publishedAt: new Date(),
        });
        slotIds.push(doomedSlot);
        const claimRes = await downApp.inject({ method: 'POST', url: `/api/v1/slots/${doomedSlot}/claims`, headers: { cookie: c, ...CSRF }, payload: {} });
        expect(claimRes.statusCode).toBe(200);
        const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
        expect((await downApp.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-intent`, headers: { cookie: c, ...CSRF }, payload: {} })).statusCode).toBe(200);
        expect((await downApp.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/payment-submission`, headers: { cookie: c, ...CSRF }, payload: { txHash: freshHash() } })).statusCode).toBe(200);
        rpcDown = await downApp.inject({ method: 'POST', url: `/api/v1/claims/${claimId}/verify-payment`, headers: { cookie: c, ...CSRF }, payload: {} });
        expect(rpcDown.statusCode).toBe(503);
      } finally {
        await downApp.close();
      }

      const cases: InjectResponse[] = [
        await app.inject({ method: 'POST', url: '/api/v1/auth/challenge', payload: { nope: 1 } }),
        await app.inject({ method: 'GET', url: '/api/v1/me' }),
        await app.inject({ method: 'GET', url: '/api/v1/admin/reports', headers: { cookie: buyerCookie, ...CSRF } }),
        await app.inject({ method: 'GET', url: `/api/v1/claims/${randomUUID()}`, headers: { cookie: buyerCookie, ...CSRF } }),
        await app.inject({ method: 'POST', url: `/api/v1/slots/${draftId}/publish`, headers: { cookie: buyerCookie, ...CSRF } }),
        await app.inject({ method: 'POST', url: '/api/v1/auth/challenge', payload: { walletAddress: 'x'.repeat(20000) } }),
        // text/plain is parsed as a string, then Zod rejects it: still fails closed.
        await app.inject({ method: 'POST', url: '/api/v1/auth/challenge', headers: { 'content-type': 'text/plain' }, payload: 'hi' }),
        rateLimited,
        rpcDown,
      ];
      const leak = /stack|postgres|database_url|select\s|insert\s+into|update\s+\w+\s+set|delete\s+from|relation\s+"|node_modules|\.ts["':\s]|Error:\s|\.env\b/i;
      const expected: Array<[number, string]> = [
        [400, 'INVALID_INPUT'],
        [401, 'UNAUTHENTICATED'],
        [403, 'FORBIDDEN'],
        [404, 'CLAIM_NOT_FOUND'],
        [409, 'SLOT_NOT_PUBLISHABLE'],
        [413, 'INVALID_INPUT'],
        [400, 'INVALID_INPUT'],
        [429, 'RATE_LIMITED'],
        [503, 'RPC_UNAVAILABLE'],
      ];
      expect(cases).toHaveLength(expected.length);
      cases.forEach((res, i) => {
        const [status, code] = expected[i] as [number, string];
        expect(res.statusCode).toBe(status);
        const body = res.json() as { error?: { code?: string; message?: string }; requestId?: string; stack?: string };
        expect(body.error?.code).toBe(code);
        expect(typeof body.requestId).toBe('string');
        expect(res.headers['x-request-id']).toBe(body.requestId);
        expect(body.stack).toBeUndefined();
        expect(JSON.stringify(body)).not.toMatch(leak);
      });
    } finally {
      await tiny.close();
    }
  }, 30000);

  it('secret hygiene: a forced 500 stays generic', async () => {
    const cookie = await loginAs(randomWallet());
    const db = getDb();
    const slotId = await makeSlot();
    await db.update(slots).set({ payoutWallet: 'CORRUPT-NOT-AN-ADDRESS' }).where(eq(slots.id, slotId));
    const claimRes = await claimAs(cookie, slotId);
    expect(claimRes.statusCode).toBe(200);
    const claimId = (claimRes.json() as { data: { claim: { id: string } } }).data.claim.id;
    const res = await intentAs(cookie, claimId);
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string; message: string }; requestId: string };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Something went wrong.');
    expect(typeof body.requestId).toBe('string');
    expect(JSON.stringify(body)).not.toMatch(/CORRUPT|SELECT|select|postgres|stack/i);
  });

  it('secret hygiene: production cookie flags are Secure', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(sessionCookieOptions()).toEqual({ path: '/', httpOnly: true, secure: true, sameSite: 'none' });
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prev;
      }
    }
    expect(sessionCookieOptions().httpOnly).toBe(true);
  });

  it('secret hygiene: server logs never carry request bodies or credentials', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          const lines = text.split('\n');
          lines.forEach((line, idx) => {
            if (/console\.log|console\.dir|console\.table/.test(line)) {
              offenders.push(`${full}:${idx + 1}: console output`);
            }
            if (/request\.log\.\w+\(/.test(line) && /body|signature|cookie|token|secret|password/i.test(line)) {
              offenders.push(`${full}:${idx + 1}: log carries sensitive input`);
            }
            if (/request\.body/.test(line) && !/safeParse/.test(line)) {
              offenders.push(`${full}:${idx + 1}: raw body reference outside validation`);
            }
          });
        }
      }
    };
    walk(API_SRC);
    expect(offenders).toEqual([]);
  });

  it('secret hygiene: the web bundle contains no server secrets', () => {
    if (!existsSync(WEB_DIST)) {
      return;
    }
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(js|css|html)$/.test(entry)) {
          files.push(full);
        }
      }
    };
    walk(WEB_DIST);
    expect(files.length).toBeGreaterThan(0);
    const hitFiles = new Set<string>();
    const secretValues = [
      process.env.DATABASE_URL,
      process.env.SESSION_SECRET,
      process.env.NIMIQ_RPC_URL,
      process.env.ADMIN_WALLET_ADDRESSES,
    ].filter((v): v is string => typeof v === 'string' && v.length >= 12);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'NIMIQ_RPC_URL', 'ADMIN_WALLET_ADDRESSES']) {
        if (text.includes(key)) {
          hitFiles.add(file);
        }
      }
      for (const value of secretValues) {
        if (text.includes(value)) {
          hitFiles.add(file);
        }
      }
    }
    // Filenames only — values and contents never enter test output.
    expect([...hitFiles]).toEqual([]);
  });

  // -- admin escalation -------------------------------------------------------------------------------

  it('admin escalation: every admin endpoint rejects anonymous and non-admin callers', async () => {
    const buyerCookie = await loginAs(randomWallet());
    const id = randomUUID();
    const routes: Array<{ method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }> = [
      { method: 'GET', url: '/api/v1/admin/reports' },
      { method: 'POST', url: `/api/v1/admin/reports/${id}/resolve`, payload: { action: 'dismissed', resolutionNotes: 'looks fine here' } },
      { method: 'POST', url: `/api/v1/admin/slots/${id}/disable`, payload: { reason: 'spam listing confirmed here' } },
      { method: 'POST', url: `/api/v1/admin/users/${id}/disable`, payload: { reason: 'abuse confirmed here' } },
      { method: 'GET', url: '/api/v1/admin/payment-reviews' },
      { method: 'POST', url: `/api/v1/admin/payment-reviews/${id}/resolve`, payload: { action: 'reject', resolutionNotes: 'no payment found here' } },
      { method: 'GET', url: '/api/v1/admin/audit-events' },
    ];
    expect(routes).toHaveLength(7);
    for (const route of routes) {
      const anon = await app.inject({ method: route.method, url: route.url, payload: route.payload });
      expect(anon.statusCode).toBe(401);
      expect((anon.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
      const buyer = await app.inject({ method: route.method, url: route.url, headers: { cookie: buyerCookie, ...CSRF }, payload: route.payload });
      expect(buyer.statusCode).toBe(403);
      const body = buyer.json() as { error: { code: string }; requestId: string };
      expect(body.error.code).toBe('FORBIDDEN');
      expect(typeof body.requestId).toBe('string');
    }
  });
});
