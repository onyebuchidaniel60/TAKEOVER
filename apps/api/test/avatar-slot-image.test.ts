// Profile avatars + opening images (Phase 5d). Live DB, real
// challenge/verify flow with an injected signature stub. Budgets are
// disabled except the avatar limiter, which is exercised at its real
// default (10/hour) by a dedicated user.
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, sessions, slots, users } from '../../../db/schema';
import {
  decodedImageByteLength,
  IMAGE_DATA_MAX_BYTES,
  nullableImageDataField,
  optionalImageDataField,
} from '../src/images/validation';

const TINY_PNG = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}`;
const TINY_JPEG = `data:image/jpeg;base64,${'A'.repeat(1024)}`;
const HUNDRED_KB = `data:image/jpeg;base64,${'A'.repeat(140000)}`;
const OVER_CAP = `data:image/jpeg;base64,${'A'.repeat(300000)}`;

describe('image data-uri validation (pure)', () => {
  it('accepts jpeg/png/webp, rejects anything else', () => {
    expect(nullableImageDataField.safeParse(TINY_PNG).success).toBe(true);
    expect(nullableImageDataField.safeParse(TINY_JPEG).success).toBe(true);
    expect(
      nullableImageDataField.safeParse(`data:image/webp;base64,${'A'.repeat(100)}`).success,
    ).toBe(true);
    expect(nullableImageDataField.safeParse(null).success).toBe(true);
    for (const bad of [
      `data:image/gif;base64,${'A'.repeat(100)}`,
      `data:image/svg+xml;base64,${'A'.repeat(100)}`,
      'https://example.com/pic.jpg',
      'not-a-uri',
      '',
      42,
    ]) {
      expect(nullableImageDataField.safeParse(bad).success).toBe(false);
    }
  });

  it('caps decoded size at 200KB', () => {
    expect(IMAGE_DATA_MAX_BYTES).toBe(200 * 1024);
    expect(nullableImageDataField.safeParse(HUNDRED_KB).success).toBe(true);
    expect(nullableImageDataField.safeParse(OVER_CAP).success).toBe(false);
    expect(optionalImageDataField.safeParse(undefined).success).toBe(true);
    expect(optionalImageDataField.safeParse(OVER_CAP).success).toBe(false);
  });

  it('measures decoded bytes, not base64 chars', () => {
    expect(decodedImageByteLength(TINY_JPEG)).toBe(768);
    expect(decodedImageByteLength(HUNDRED_KB)).toBeLessThanOrEqual(IMAGE_DATA_MAX_BYTES);
    expect(decodedImageByteLength(OVER_CAP)).toBeGreaterThan(IMAGE_DATA_MAX_BYTES);
  });
});

describe.skipIf(!isDatabaseConfigured())('avatars + opening images (live DB)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      slotCreate: { windowMs: 60_000, max: 1000 },
      slotMutate: { windowMs: 60_000, max: 1000 },
      providerClaims: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const HOUR = 3_600_000;

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.push(wallet);
    return wallet;
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
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, wallet))
      .limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlotFor(
    providerId: string,
    status: 'draft' | 'published' = 'published',
  ): Promise<string> {
    const db = getDb();
    const now = Date.now();
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `IMG ${tag} slot`,
      description: `IMG ${tag} description`,
      category: 'Event',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 1500000n,
      totalQuantity: 4,
      availableQuantity: 4,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    slotIds.push(id);
    return id;
  }

  async function patchAvatar(
    cookie: string | null,
    body: Record<string, unknown>,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'PATCH',
      url: '/api/v1/me/avatar',
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: body,
    });
  }

  async function patchImage(
    cookie: string | null,
    slotId: string,
    body: Record<string, unknown>,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/me/slots/${slotId}/image`,
      ...(cookie ? { headers: { cookie, ...CSRF } } : {}),
      payload: body,
    });
  }

  async function avatarAudits(userId: string): Promise<{ metadata: unknown }[]> {
    const db = getDb();
    return db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, userId), eq(auditEvents.eventType, 'user.avatar_updated')));
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
        await db.delete(auditEvents).where(inArray(auditEvents.entityId, claimIds));
        await db.delete(claims).where(inArray(claims.id, claimIds));
      }
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
        await db.delete(auditEvents).where(inArray(auditEvents.entityId, userIds));
        await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    await app.close();
  });

  it('PATCH /me/avatar persists and GET /me returns it', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const userId = await userIdFor(wallets[wallets.length - 1] as string);
    const res = await patchAvatar(cookie, { avatarData: TINY_PNG });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { avatarData: string } }).data.avatarData).toBe(TINY_PNG);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { data: { user: { avatarData: string } } }).data.user.avatarData).toBe(
      TINY_PNG,
    );
    const rows = await avatarAudits(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ hadAvatar: false });
  });

  it('PATCH null clears and same-value re-set is a no-op without a second audit', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const userId = await userIdFor(wallets[wallets.length - 1] as string);
    expect((await patchAvatar(cookie, { avatarData: TINY_JPEG })).statusCode).toBe(200);
    const cleared = await patchAvatar(cookie, { avatarData: null });
    expect(cleared.statusCode).toBe(200);
    expect(
      (cleared.json() as { data: { avatarData: string | null } }).data.avatarData,
    ).toBeNull();
    const repeat = await patchAvatar(cookie, { avatarData: null });
    expect(repeat.statusCode).toBe(200);
    const rows = await avatarAudits(userId);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.metadata).toEqual({ hadAvatar: true });
  });

  it('PATCH /me/avatar rejects bad bodies with 400 and anon with 401', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const userId = await userIdFor(wallets[wallets.length - 1] as string);
    for (const body of [
      { avatarData: `data:image/gif;base64,${'A'.repeat(100)}` },
      { avatarData: 'https://example.com/me.jpg' },
      { avatarData: OVER_CAP },
      { avatarData: TINY_PNG, extra: 1 },
      { avatarData: 42 },
      {},
    ]) {
      const res = await patchAvatar(cookie, body);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
    }
    expect(await avatarAudits(userId)).toHaveLength(0);
    const anon = await patchAvatar(null, { avatarData: TINY_PNG });
    expect(anon.statusCode).toBe(401);
  });

  it('avatar uploads are rate-limited to 10 per hour per user', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    for (let i = 0; i < 10; i++) {
      const res = await patchAvatar(cookie, { avatarData: i % 2 === 0 ? TINY_PNG : null });
      expect(res.statusCode).toBe(200);
    }
    const limited = await patchAvatar(cookie, { avatarData: TINY_PNG });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('POST /slots accepts image_data and both projections carry it', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: {
        title: `IMG ${tag} created`,
        starts_at: new Date(Date.now() + 2 * HOUR).toISOString(),
        price_usdt: '1500000',
        total_quantity: 2,
        image_data: TINY_JPEG,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { data: { slot: Record<string, unknown> } }).data.slot;
    expect(created['imageData']).toBe(TINY_JPEG);
    slotIds.push(created['id'] as string);
    // Draft PATCH accepts it too.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${created['id']}`,
      headers: { cookie, ...CSRF },
      payload: { image_data: TINY_PNG },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { data: { slot: Record<string, unknown> } }).data.slot['imageData']).toBe(
      TINY_PNG,
    );
  });

  it('image endpoint edits published slots while commercial PATCH stays draft-locked', { timeout: 60_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1] as string);
    const slotId = await makeSlotFor(providerId, 'published');
    // Commercial PATCH on a published slot is still rejected (state machine unchanged).
    const locked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/slots/${slotId}`,
      headers: { cookie, ...CSRF },
      payload: { image_data: TINY_JPEG },
    });
    expect(locked.statusCode).toBe(409);
    // The dedicated image endpoint is open on published slots.
    const set = await patchImage(cookie, slotId, { image_data: TINY_JPEG });
    expect(set.statusCode).toBe(200);
    expect((set.json() as { data: { slot: Record<string, unknown> } }).data.slot['imageData']).toBe(
      TINY_JPEG,
    );
    // Public detail carries the image; audit carries IDs only.
    const pub = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { data: { slot: Record<string, unknown> } }).data.slot['imageData']).toBe(
      TINY_JPEG,
    );
    const db = getDb();
    const audits = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, slotId), eq(auditEvents.eventType, 'slot.image_updated')));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual({ slotId, hadImage: false });
    // Clear + no-op re-clear (single second audit for the clear).
    expect((await patchImage(cookie, slotId, { image_data: null })).statusCode).toBe(200);
    expect((await patchImage(cookie, slotId, { image_data: null })).statusCode).toBe(200);
    const after = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, slotId), eq(auditEvents.eventType, 'slot.image_updated')));
    expect(after).toHaveLength(2);
  });

  it('image endpoint 404s non-owners, 401s anon, 400s bad bodies', { timeout: 60_000 }, async () => {
    const ownerCookie = await loginAs(randomWallet());
    const ownerId = await userIdFor(wallets[wallets.length - 1] as string);
    const slotId = await makeSlotFor(ownerId);
    const strangerCookie = await loginAs(randomWallet());
    const foreign = await patchImage(strangerCookie, slotId, { image_data: TINY_JPEG });
    expect(foreign.statusCode).toBe(404);
    const anon = await patchImage(null, slotId, { image_data: TINY_JPEG });
    expect(anon.statusCode).toBe(401);
    for (const body of [{ image_data: OVER_CAP }, { image_data: 'nope' }, {}, { image_data: TINY_JPEG, extra: 1 }]) {
      const res = await patchImage(ownerCookie, slotId, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('public slots carry providerAvatar; provider claims carry buyerAvatar', { timeout: 60_000 }, async () => {
    const providerCookie = await loginAs(randomWallet());
    const providerId = await userIdFor(wallets[wallets.length - 1] as string);
    expect((await patchAvatar(providerCookie, { avatarData: TINY_PNG })).statusCode).toBe(200);
    const slotId = await makeSlotFor(providerId, 'published');
    const pub = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(pub.statusCode).toBe(200);
    expect(
      (pub.json() as { data: { slot: Record<string, unknown> } }).data.slot['providerAvatar'],
    ).toBe(TINY_PNG);
    const buyerCookie = await loginAs(randomWallet());
    expect((await patchAvatar(buyerCookie, { avatarData: TINY_JPEG })).statusCode).toBe(200);
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie: buyerCookie, ...CSRF },
      payload: {},
    });
    expect(claimRes.statusCode).toBe(200);
    const demand = await app.inject({
      method: 'GET',
      url: `/api/v1/me/slots/${slotId}/claims`,
      headers: { cookie: providerCookie },
    });
    expect(demand.statusCode).toBe(200);
    const items = (demand.json() as { data: { claims: Record<string, unknown>[] } }).data.claims;
    expect(items).toHaveLength(1);
    expect(items[0]?.['buyerAvatar']).toBe(TINY_JPEG);
  });
});
