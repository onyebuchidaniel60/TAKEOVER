// Phase 5n-B: email became editable through PATCH /me/profile.
//
// Email is the only IDENTITY field in that patch (phone/dob/location are
// optional profile data), so the properties that matter are the identity
// ones: normalization, uniqueness, and the fact that the audit records the
// FIELD NAME but never the value.
import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, providerProfiles, sessions, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('profile email edit (live)', () => {
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: () => true,
    rateLimit: { challenge: generous, verify: generous, register: generous, publicProfile: generous },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const userIds: string[] = [];
  // Usernames are capped at 20 chars, and `register()` prepends a 1-char
  // discriminator, so the random part is sized to fit (8 + 6 + 3 + 1 = 18).
  const uniq = (): string =>
    `test_5nb${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1000)}`;

  async function register(prefix: string): Promise<{ id: string; email: string; cookie: string }> {
    const username = `${prefix}${uniq()}`;
    const email = `${username}@test.local`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email, password: 'audit-password-long', username },
    });
    if (res.statusCode !== 200) {
      throw new Error(`register failed: ${res.statusCode} ${res.body} (username=${username})`);
    }
    const sc = res.headers['set-cookie'];
    const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
    const cookie = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0] ?? '';
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const id = (me.json() as { data: { user: { id: string } } }).data.user.id;
    userIds.push(id);
    return { id, email, cookie };
  }

  async function patch(cookie: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { ...CSRF, cookie, 'content-type': 'application/json' },
      payload: body,
    });
  }

  afterEach(async () => {
    if (userIds.length === 0) return;
    const db = getDb();
    const ids = userIds.splice(0);
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
    await db.delete(providerProfiles).where(inArray(providerProfiles.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });

  it('changes the email and serves it back on /me', async () => {
    const user = await register('a');
    const next = `${uniq()}@test.local`;
    const res = await patch(user.cookie, { email: next });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: user.cookie } });
    expect((me.json() as { data: { user: { email: string } } }).data.user.email).toBe(next);
  });

  it('normalizes case, so changing case only is a no-op and cannot fork an identity', async () => {
    const user = await register('b');
    const upper = user.email.toUpperCase();
    const res = await patch(user.cookie, { email: upper });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: user.cookie } });
    // Stored lowercase again — one identity, not two spellings of it.
    expect((me.json() as { data: { user: { email: string } } }).data.user.email).toBe(user.email);
  });

  it('rejects an email already on another account with 409 EMAIL_TAKEN', async () => {
    const mine = await register('c');
    const theirs = await register('d');
    const res = await patch(mine.cookie, { email: theirs.email });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');
  });

  it('allows keeping your OWN email (not treated as a conflict with yourself)', async () => {
    const user = await register('e');
    const res = await patch(user.cookie, { email: user.email, phone: '+49 170 0000000' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a malformed email with 400 and changes nothing', async () => {
    const user = await register('f');
    const res = await patch(user.cookie, { email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: user.cookie } });
    expect((me.json() as { data: { user: { email: string } } }).data.user.email).toBe(user.email);
  });

  it('audits the FIELD NAME, never the value', async () => {
    const user = await register('g');
    const next = `${uniq()}@test.local`;
    await patch(user.cookie, { email: next, location: 'Kreuzberg' });
    const events = await getDb()
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.actorUserId, [user.id]));
    const profile = events.filter((e) => e.eventType === 'user.profile_updated');
    expect(profile.length).toBeGreaterThan(0);
    const meta = JSON.stringify(profile.map((e) => e.metadata));
    expect(meta).toContain('email');
    // The address itself must never reach the audit log.
    expect(meta).not.toContain(next);
    expect(meta).not.toContain('Kreuzberg');
  });

  it('clears the email with null', async () => {
    const user = await register('h');
    const res = await patch(user.cookie, { email: null });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: user.cookie } });
    expect((me.json() as { data: { user: { email: string | null } } }).data.user.email).toBeNull();
  });
});
