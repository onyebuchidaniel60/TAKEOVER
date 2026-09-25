// Phase 5g dual-identity suite (live DB): email register/login,
// username validation + availability, and the claim-creation wallet gate.
// Test users use the Phase 5g conventions (@test.local emails, test_
// usernames) so scripts/db/cleanup-test-data.mjs matches them; this file
// also deletes everything it creates in afterEach (tracked ids).
import { afterEach, describe, expect, it, vi } from 'vitest';

// Live-DB chains measure seconds per test against remote Postgres;
// file-level budget per the claims.test.ts precedent.
vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { hashPassword, validatePassword, verifyPassword } from '../src/auth/password';
import { validateEmail, validateUsername } from '../src/auth/identity';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, claims, sessions, slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('email auth + wallet gate (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: {
      challenge: generous,
      verify: generous,
      register: { windowMs: 3_600_000, max: 1000 },
      login: generous,
      usernameAvailable: generous,
      claimCreate: generous,
    },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  const userIds: string[] = [];
  const slotIds: string[] = [];
  const claimIds: string[] = [];

  function randHex(n = 8): string {
    return randomUUID().replace(/-/g, '').slice(0, n);
  }

  /** Fresh identity triple following the test conventions. */
  function freshIdentity(): { email: string; username: string; password: string } {
    const tag = randHex();
    return { email: `test_${tag}@test.local`, username: `test_${tag}`, password: `pw-${tag}-long-enough` };
  }

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    return deriveNimiqAddress(publicKey);
  }

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  function trackUser(id: string): void {
    userIds.push(id);
  }

  async function register(
    target: FastifyInstance,
    body: Record<string, string>,
  ): Promise<InjectResponse> {
    return target.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });
  }

  async function login(target: FastifyInstance, body: Record<string, string>): Promise<InjectResponse> {
    return target.inject({ method: 'POST', url: '/api/v1/auth/login', payload: body });
  }

  async function loginAsWallet(wallet: string): Promise<string> {
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
    trackUser((verify.json() as { data: { user: { id: string } } }).data.user.id);
    return sessionCookieFrom(verify);
  }

  async function makeSlot(): Promise<string> {
    const db = getDb();
    const tag = randHex();
    const providerWallet = randomWallet();
    const insertedUsers = await db
      .insert(users)
      .values({ walletAddress: providerWallet, role: 'buyer' })
      .returning({ id: users.id });
    trackUser(insertedUsers[0].id);
    const now = Date.now();
    const HOUR = 3_600_000;
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId: insertedUsers[0].id,
      title: `test-5g email-auth ${tag}`,
      description: `test-5g email-auth slot ${tag}`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceUsdt: 150000n,
      totalQuantity: 4,
      availableQuantity: 4,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  afterEach(async () => {
    const db = getDb();
    if (claimIds.length > 0) {
      await db.delete(claims).where(inArray(claims.id, claimIds));
      claimIds.length = 0;
    }
    if (slotIds.length > 0) {
      await db.delete(slots).where(inArray(slots.id, slotIds));
      slotIds.length = 0;
    }
    if (userIds.length > 0) {
      await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
      userIds.length = 0;
    }
  });

  it('register happy path creates a wallet-less user plus a session', async () => {
    const id = freshIdentity();
    const res = await register(app, id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        user: {
          id: string;
          email: string;
          username: string;
          walletAddress: string | null;
          role: string;
          status: string;
        };
        sessionToken: string;
      };
      requestId: string;
    };
    expect(typeof body.requestId).toBe('string');
    expect(body.data.user.email).toBe(id.email);
    expect(body.data.user.username).toBe(id.username);
    expect(body.data.user.walletAddress).toBeNull();
    expect(body.data.user.role).toBe('buyer');
    expect(body.data.user.status).toBe('active');
    expect(typeof body.data.sessionToken).toBe('string');
    expect(sessionCookieFrom(res)).toMatch(/^takeover_session=/);
    trackUser(body.data.user.id);

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, body.data.user.id)).limit(1);
    expect(rows[0].email).toBe(id.email);
    expect(rows[0].username).toBe(id.username);
    expect(rows[0].walletAddress).toBeNull();
    expect(rows[0].passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, body.data.user.id));
    const created = audits.find((a) => a.eventType === 'user.created');
    expect(created).toBeDefined();
    expect(created?.metadata).toMatchObject({ auth_method: 'email' });
    const metadata = (created?.metadata ?? {}) as Record<string, unknown>;
    expect('password' in metadata).toBe(false);
    expect('email' in metadata).toBe(false);
  });

  it('register rejects a duplicate email (exact and case-variant)', async () => {
    const id = freshIdentity();
    const first = await register(app, id);
    expect(first.statusCode).toBe(200);
    trackUser((first.json() as { data: { user: { id: string } } }).data.user.id);

    const dup = await register(app, { ...freshIdentity(), email: id.email, password: 'another-long-password' });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');

    const upper = await register(app, {
      email: id.email.toUpperCase(),
      password: 'another-long-password',
      username: `test_${randHex()}`,
    });
    expect(upper.statusCode).toBe(409);
    expect((upper.json() as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');
  });

  it('register rejects a duplicate username', async () => {
    const id = freshIdentity();
    const first = await register(app, id);
    expect(first.statusCode).toBe(200);
    trackUser((first.json() as { data: { user: { id: string } } }).data.user.id);

    const dup = await register(app, {
      email: `test_${randHex()}@test.local`,
      password: 'another-long-password',
      username: id.username,
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: { code: string } }).error.code).toBe('USERNAME_TAKEN');
  });

  it('register rejects invalid email/password/username', async () => {
    const badEmails = ['not-an-email', 'a@b', 'a @b.c', '', 'a@b@c.d'];
    for (const email of badEmails) {
      const res = await register(app, { email, password: 'long-enough-password', username: `test_${randHex()}` });
      expect(res.statusCode).toBe(400);
    }
    const base = freshIdentity();
    const short = await register(app, { ...base, password: 'short' });
    expect(short.statusCode).toBe(400);
    const asEmail = await register(app, { ...base, password: base.email });
    expect(asEmail.statusCode).toBe(400);
    const asUsername = await register(app, { ...base, password: base.username });
    expect(asUsername.statusCode).toBe(400);

    const badUsernames = ['ab', '1abc', 'a__b', 'abc_', 'x'.repeat(21), 'has space', 'has-dash'];
    for (const username of badUsernames) {
      const res = await register(app, {
        email: `test_${randHex()}@test.local`,
        password: 'long-enough-password',
        username,
      });
      expect(res.statusCode).toBe(400);
    }
    const reserved = await register(app, {
      email: `test_${randHex()}@test.local`,
      password: 'long-enough-password',
      username: 'admin',
    });
    expect(reserved.statusCode).toBe(400);
  });

  it('login happy path returns a session', async () => {
    const id = freshIdentity();
    const reg = await register(app, id);
    expect(reg.statusCode).toBe(200);
    trackUser((reg.json() as { data: { user: { id: string } } }).data.user.id);

    const res = await login(app, { email: id.email, password: id.password });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { user: { id: string; email: string; username: string }; sessionToken: string };
      requestId: string;
    };
    expect(body.data.user.email).toBe(id.email);
    expect(typeof body.data.sessionToken).toBe('string');
    expect(sessionCookieFrom(res)).toMatch(/^takeover_session=/);

    const db = getDb();
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, body.data.user.id));
    expect(audits.find((a) => a.eventType === 'user.logged_in')).toBeDefined();
  });

  it('login hides whether the email or password failed', async () => {
    const id = freshIdentity();
    const reg = await register(app, id);
    expect(reg.statusCode).toBe(200);
    trackUser((reg.json() as { data: { user: { id: string } } }).data.user.id);

    const wrongPassword = await login(app, { email: id.email, password: 'wrong-password-long' });
    const unknownEmail = await login(app, {
      email: `test_${randHex()}@test.local`,
      password: 'wrong-password-long',
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    const wrongBody = wrongPassword.json() as { error: { code: string; message: string } };
    const unknownBody = unknownEmail.json() as { error: { code: string; message: string } };
    expect(wrongBody.error).toEqual(unknownBody.error);
    expect(wrongBody.error.code).toBe('UNAUTHENTICATED');
  });

  it('login rejects a disabled user with ACCOUNT_DISABLED', async () => {
    const id = freshIdentity();
    const reg = await register(app, id);
    expect(reg.statusCode).toBe(200);
    const userId = (reg.json() as { data: { user: { id: string } } }).data.user.id;
    trackUser(userId);

    const db = getDb();
    await db
      .update(users)
      .set({ status: 'disabled', disabledAt: new Date() })
      .where(eq(users.id, userId));

    const res = await login(app, { email: id.email, password: id.password });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('username-available reports valid, invalid, reserved, and taken', async () => {
    const id = freshIdentity();
    const reg = await register(app, id);
    expect(reg.statusCode).toBe(200);
    trackUser((reg.json() as { data: { user: { id: string } } }).data.user.id);

    const fresh = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/username-available?username=test_${randHex()}`,
    });
    expect(fresh.statusCode).toBe(200);
    expect((fresh.json() as { data: unknown }).data).toEqual({ available: true });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/username-available?username=ab',
    });
    expect((invalid.json() as { data: unknown }).data).toEqual({ available: false, reason: 'format' });

    const reserved = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/username-available?username=admin',
    });
    expect((reserved.json() as { data: unknown }).data).toEqual({ available: false, reason: 'reserved' });

    const taken = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/username-available?username=${id.username}`,
    });
    expect((taken.json() as { data: unknown }).data).toEqual({ available: false, reason: 'taken' });

    const missing = await app.inject({ method: 'GET', url: '/api/v1/auth/username-available' });
    expect(missing.statusCode).toBe(400);
  });

  it('claim creation without a wallet returns WALLET_REQUIRED; with a wallet it succeeds', async () => {
    const slotId = await makeSlot();

    const id = freshIdentity();
    const reg = await register(app, id);
    expect(reg.statusCode).toBe(200);
    trackUser((reg.json() as { data: { user: { id: string } } }).data.user.id);
    const emailCookie = sessionCookieFrom(reg);

    const gated = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie: emailCookie, ...CSRF },
      payload: {},
    });
    expect(gated.statusCode).toBe(409);
    expect((gated.json() as { error: { code: string } }).error.code).toBe('WALLET_REQUIRED');

    const walletCookie = await loginAsWallet(randomWallet());
    const allowed = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie: walletCookie, ...CSRF },
      payload: {},
    });
    expect(allowed.statusCode).toBe(200);
    const claimId = (allowed.json() as { data: { claim: { id: string } } }).data.claim.id;
    expect(typeof claimId).toBe('string');
    claimIds.push(claimId);
  });

  it('rate-limits register, login, per-email failures, and username-available', async () => {
    const registerApp = buildApp({ rateLimit: { register: { windowMs: 60_000, max: 2 } } });
    for (let i = 0; i < 2; i += 1) {
      const res = await register(registerApp, freshIdentity());
      expect(res.statusCode).toBe(200);
      trackUser((res.json() as { data: { user: { id: string } } }).data.user.id);
    }
    const registerLimited = await register(registerApp, freshIdentity());
    expect(registerLimited.statusCode).toBe(429);
    expect((registerLimited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');

    const loginApp = buildApp({
      rateLimit: {
        login: { windowMs: 60_000, max: 2 },
        loginEmailFailure: { windowMs: 60_000, max: 1000 },
      },
    });
    for (let i = 0; i < 2; i += 1) {
      const res = await login(loginApp, {
        email: `test_${randHex()}@test.local`,
        password: 'wrong-password-long',
      });
      expect(res.statusCode).toBe(401);
    }
    const loginLimited = await login(loginApp, {
      email: `test_${randHex()}@test.local`,
      password: 'wrong-password-long',
    });
    expect(loginLimited.statusCode).toBe(429);

    const emailBudgetApp = buildApp({
      rateLimit: {
        login: { windowMs: 60_000, max: 1000 },
        loginEmailFailure: { windowMs: 60_000, max: 2 },
      },
    });
    const targetEmail = `test_${randHex()}@test.local`;
    for (let i = 0; i < 2; i += 1) {
      const res = await login(emailBudgetApp, { email: targetEmail, password: 'wrong-password-long' });
      expect(res.statusCode).toBe(401);
    }
    const emailLimited = await login(emailBudgetApp, { email: targetEmail, password: 'wrong-password-long' });
    expect(emailLimited.statusCode).toBe(429);
    expect((emailLimited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');

    const usernameApp = buildApp({ rateLimit: { usernameAvailable: { windowMs: 60_000, max: 2 } } });
    for (let i = 0; i < 2; i += 1) {
      const res = await usernameApp.inject({
        method: 'GET',
        url: `/api/v1/auth/username-available?username=test_${randHex()}`,
      });
      expect(res.statusCode).toBe(200);
    }
    const usernameLimited = await usernameApp.inject({
      method: 'GET',
      url: `/api/v1/auth/username-available?username=test_${randHex()}`,
    });
    expect(usernameLimited.statusCode).toBe(429);
  });

  it('password hashing round-trips with timing-safe verify and rejects malformed rows', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
    expect(await verifyPassword('correct-horse-battery-staple', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('correct-horse-battery-staple', 'scrypt$1$1$1$AAAA$BBBB')).toBe(false);

    expect(validatePassword('short', {})).toEqual({ ok: false, reason: 'too_short' });
    expect(validatePassword('long-enough-password', {})).toEqual({ ok: true });
    expect(validatePassword('Alice@Test.Local', { email: 'alice@test.local' })).toEqual({
      ok: false,
      reason: 'matches_email',
    });
    expect(validateEmail('Alice@Test.Local')).toEqual({ ok: true, value: 'alice@test.local' });
    expect(validateEmail('no-at-sign')).toEqual({ ok: false, reason: 'format' });
    expect(validateUsername('Alice')).toEqual({ ok: true, value: 'alice' });
    expect(validateUsername('admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateUsername('ab')).toEqual({ ok: false, reason: 'format' });
  });
});
