// Phase 14c round 3 — bodyless-mutation regression suite (live DB).
// Round-2 Bug 1: the frontend sent bodyless POSTs under
// content-type: application/json, which Fastify rejects before routing
// (FST_ERR_CTP_EMPTY_JSON_BODY → 400 'Invalid request.'). The approved fix
// is client-side (`{}` bodies + conditional content-type); these tests pin
// the server-visible contract: publish/cancel/logout accept `{}` bodies,
// and logout with `{}` actually revokes the session.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, sessions, slots, users } from '../../../db/schema';

// Remote-Postgres latency: 30s budget per test (Phase 10 precedent).
vi.setConfig({ testTimeout: 30000 });

describe.skipIf(!isDatabaseConfigured())('phase 14c round 3 bodyless mutations (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 3_600_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
    },
  });

  const wallets: string[] = [];
  const slotIds: string[] = [];
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.push(wallet);
    return wallet;
  }

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  async function loginAs(wallet: string): Promise<{ cookie: string; token: string }> {
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
    const body = verify.json() as { data: { sessionToken: string } };
    return { cookie: sessionCookieFrom(verify), token: body.data.sessionToken };
  }

  function draftBody(): Record<string, unknown> {
    const now = Date.now();
    return {
      title: 'Round3 no-body probe',
      description: 'regression fixture',
      category: 'dining',
      location_label: 'Mitte',
      starts_at: new Date(now + 24 * 3_600_000).toISOString(),
      ends_at: new Date(now + 25 * 3_600_000).toISOString(),
      price_usdt: '100000',
      total_quantity: 1,
    };
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (wallets.length > 0) {
      const found = await db.select({ id: users.id }).from(users).where(inArray(users.walletAddress, wallets));
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

  it('publish with a {} body succeeds (Bug 1 regression)', async () => {
    const wallet = randomWallet();
    const { cookie } = await loginAs(wallet);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: draftBody(),
    });
    expect(created.statusCode).toBe(201);
    const slotId = (created.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(slotId);
    // The exact shape the fixed frontend now sends: JSON content-type with
    // an (empty-object) body.
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/publish`,
      headers: { cookie, ...CSRF, 'content-type': 'application/json' },
      payload: {},
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');
  });

  it('cancel with a {} body succeeds (collateral regression)', async () => {
    const wallet = randomWallet();
    const { cookie } = await loginAs(wallet);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: draftBody(),
    });
    expect(created.statusCode).toBe(201);
    const slotId = (created.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(slotId);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/cancel`,
      headers: { cookie, ...CSRF, 'content-type': 'application/json' },
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('cancelled');
  });

  it('logout with a {} body actually revokes the session (cookie path)', async () => {
    const { cookie } = await loginAs(randomWallet());
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, ...CSRF, 'content-type': 'application/json' },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('logout with a {} body actually revokes the session (Bearer path)', async () => {
    const { token } = await loginAs(randomWallet());
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('empty JSON bodies stay rejected before routing (strict parser intact)', async () => {
    // NOTE — deliberate deviation from the round-3 brief's literal prescription
    // ("assert 2xx"), recorded here instead of decided silently: a truly-empty
    // body under content-type: application/json 400s inside Fastify's default
    // JSON parser (FST_ERR_CTP_EMPTY_JSON_BODY) before any route runs, and the
    // app maps it to INVALID_INPUT / 'Invalid request.'. That strictness is
    // INTENTIONAL and load-bearing (urlencoded-415 / text-plain-400 posture
    // proven by the security suite), and the approved Fix A is client-side
    // only — so no server change may make this 2xx. This test pins the strict
    // behavior so a future "tolerance" change cannot slip in quietly; the true
    // Bug-1 regression coverage is the `{}` acceptance above plus the web
    // request-body tests proving mutations always carry a body.
    const wallet = randomWallet();
    const { cookie } = await loginAs(wallet);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: draftBody(),
    });
    const slotId = (created.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(slotId);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/publish`,
      headers: { cookie, ...CSRF, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toBe('Invalid request.');
  });
});
