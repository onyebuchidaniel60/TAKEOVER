// Phase 5j backend suite (live DB): onboarded_at completion endpoint and
// the self-service profile scalars. Fixtures are wallet users inserted
// directly with onboarded_at NULL (simulating a fresh account); every row
// created here is deleted in afterEach (tracked ids).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, sessions, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('onboarding backend (live)', () => {
  const stubVerifier: VerifySignatureFn = () => true;
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: stubVerifier,
    rateLimit: { challenge: generous, verify: generous },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const userIds: string[] = [];

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
  }

  async function freshUserCookie(): Promise<{ cookie: string; userId: string }> {
    const db = getDb();
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    const inserted = await db
      .insert(users)
      .values({ walletAddress: wallet, role: 'buyer', onboardedAt: null })
      .returning({ id: users.id });
    const userId = inserted[0].id;
    userIds.push(userId);
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
    return { cookie: sessionCookieFrom(verify), userId };
  }

  afterEach(async () => {
    const db = getDb();
    if (userIds.length > 0) {
      await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
      userIds.length = 0;
    }
  });

  it('POST /me/onboarded sets onboarded_at once and is idempotent', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/v1/me/onboarded', payload: {} });
    expect(anon.statusCode).toBe(401);

    const { cookie, userId } = await freshUserCookie();

    const meBefore = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(meBefore.statusCode).toBe(200);
    expect((meBefore.json() as { data: { user: { onboardedAt: unknown } } }).data.user.onboardedAt).toBeNull();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/me/onboarded',
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const firstUser = (first.json() as { data: { user: { onboardedAt: string } } }).data.user;
    expect(typeof firstUser.onboardedAt).toBe('string');

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(rows[0].onboardedAt).not.toBeNull();

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/me/onboarded',
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { user: { onboardedAt: string } } }).data.user.onboardedAt).toBe(
      firstUser.onboardedAt,
    );

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, userId));
    expect(audits.filter((a) => a.eventType === 'user.onboarded')).toHaveLength(1);
  });

  it('PATCH /me/profile writes, clears, and validates the scalars', async () => {
    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      payload: { bio: 'hi' },
    });
    expect(anon.statusCode).toBe(401);

    const { cookie, userId } = await freshUserCookie();
    const patch = (body: Record<string, string>): Promise<InjectResponse> =>
      app.inject({
        method: 'PATCH',
        url: '/api/v1/me/profile',
        headers: { cookie, ...CSRF },
        payload: body,
      });

    const full = await patch({
      bio: 'Regular at the night market.',
      phone: '+49 170 123456',
      dob: '1990-04-12',
      location: 'Kreuzberg',
    });
    expect(full.statusCode).toBe(200);
    expect((full.json() as { data: { profile: unknown } }).data.profile).toEqual({
      bio: 'Regular at the night market.',
      phone: '+49 170 123456',
      dob: '1990-04-12',
      location: 'Kreuzberg',
    });

    const db = getDb();
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, userId));
    const profileAudit = audits.find((a) => a.eventType === 'user.profile_updated');
    expect(profileAudit).toBeDefined();
    // Field names only — values are PII and never enter metadata.
    expect(profileAudit?.metadata).toEqual({ fields: ['bio', 'phone', 'dob', 'location'] });

    // Partial update keeps the rest; '' clears to NULL.
    const partial = await patch({ bio: '', location: 'Neukölln' });
    expect(partial.statusCode).toBe(200);
    expect((partial.json() as { data: { profile: unknown } }).data.profile).toEqual({
      bio: null,
      phone: '+49 170 123456',
      dob: '1990-04-12',
      location: 'Neukölln',
    });

    // No-op re-set writes no second audit.
    const noop = await patch({ location: 'Neukölln' });
    expect(noop.statusCode).toBe(200);
    const auditsAfter = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, userId));
    expect(auditsAfter.filter((a) => a.eventType === 'user.profile_updated')).toHaveLength(2);

    // Validation matrix.
    const badBodies: Record<string, string>[] = [
      { bio: 'x'.repeat(161) },
      { bio: 'see https://example.com for more' },
      { bio: 'see www.example.com for more' },
      { phone: 'ab' },
      { phone: 'call me maybe!' },
      { dob: '12-04-1990' },
      { dob: '1990-02-30' },
      { dob: '2999-01-01' },
      { location: 'x'.repeat(201) },
      { nickname: 'sneaky' },
    ];
    for (const body of badBodies) {
      const res = await patch(body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('GET /me serves the new projection fields', async () => {
    const { cookie } = await freshUserCookie();
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const user = (res.json() as { data: { user: Record<string, unknown> } }).data.user;
    expect('onboardedAt' in user).toBe(true);
    expect(user.bio).toBeNull();
    expect(user.phone).toBeNull();
    expect(user.dob).toBeNull();
    expect(user.location).toBeNull();
  });

  it('migration 0015 grandfathered pre-existing users', async () => {
    // New rows default to NULL (they enter the funnel); rows older than any
    // in-flight suite run must all carry onboarded_at from the backfill.
    const db = getDb();
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM users WHERE onboarded_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'`,
    );
    expect(Number(rows.rows[0].n)).toBe(0);
  });
});
