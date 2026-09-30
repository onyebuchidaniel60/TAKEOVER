// Phase 5k-B: the public profile endpoint.
//
// The security point of this file is the negative assertion: GET
// /api/v1/users/:username is UNAUTHENTICATED, so the response must be
// allow-listed. A leaked email/phone/dob/wallet is a privacy incident, and
// a naive `return the users row` implementation would pass every positive
// test while failing exactly this one. The key walk is therefore recursive:
// a nested leak counts, not just top-level keys.
//
// Fixtures are inserted directly (deterministic, no auth dance) and every
// row is removed in afterEach.
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { users, providerProfiles } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('public profile (live)', () => {
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: () => true,
    rateLimit: { challenge: generous, verify: generous, publicProfile: generous },
  });

  const userIds: string[] = [];
  const uniq = (): string => `test_5kb${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  async function makeUser(over: Record<string, unknown> = {}): Promise<{ id: string; username: string }> {
    const db = getDb();
    const username = uniq();
    const inserted = await db
      .insert(users)
      .values({
        username,
        email: `${username}@test.local`,
        walletAddress: null,
        bio: 'Sells good tables.',
        location: 'Mitte',
        phone: '+49 000 0000000',
        dob: '1990-04-01',
        role: 'buyer',
        ...over,
      })
      .returning({ id: users.id, username: users.username });
    userIds.push(inserted[0].id);
    return { id: inserted[0].id, username: inserted[0].username as string };
  }

  afterEach(async () => {
    if (userIds.length === 0) return;
    const db = getDb();
    const ids = userIds.splice(0);
    // provider_profiles references users, so the child row goes first.
    await db.delete(providerProfiles).where(inArray(providerProfiles.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });

  /** Every key anywhere in the payload, dotted for nesting. */
  function allKeys(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) return value.flatMap((v) => allKeys(v, prefix));
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k;
        return [path, ...allKeys(v, path)];
      });
    }
    return [];
  }

  it('serves a public profile with no authentication', async () => {
    const { username } = await makeUser();
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username}` });
    expect(res.statusCode).toBe(200);
    const profile = (res.json() as { data: { profile: Record<string, unknown> } }).data.profile;
    expect(profile.username).toBe(username);
    expect(profile.bio).toBe('Sells good tables.');
    expect(profile.location).toBe('Mitte');
    expect(profile.avatarData).toBeNull();
    expect(profile.displayName).toBe(`@${username}`);
    expect(profile.memberSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profile.stats).toMatchObject({ openings: 0, claims: 0 });
  });

  it('never returns private identity fields (the whole point of the allow-list)', async () => {
    const { username } = await makeUser();
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username}` });
    expect(res.statusCode).toBe(200);
    const keys = allKeys((res.json() as { data: unknown }).data);
    for (const forbidden of ['email', 'phone', 'dob', 'walletAddress', 'passwordHash', 'role', 'status', 'id']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('returns a display name from the provider profile when one is set', async () => {
    const { id, username } = await makeUser();
    await getDb()
      .insert(providerProfiles)
      .values({ userId: id, displayName: 'Sunrise Yoga' })
      .onConflictDoNothing();
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username}` });
    const profile = (res.json() as { data: { profile: { displayName: string } } }).data.profile;
    expect(profile.displayName).toBe('Sunrise Yoga');
  });

  it('404s an unknown username', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/nobody_here_at_all' });
    expect(res.statusCode).toBe(404);
  });

  it('treats a disabled account as not found (no account enumeration)', async () => {
    const { username } = await makeUser({ status: 'disabled' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username}` });
    expect(res.statusCode).toBe(404);
  });

  it('normalizes case in the lookup (handles are stored lowercased)', async () => {
    const { username } = await makeUser();
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username.toUpperCase()}` });
    expect(res.statusCode).toBe(200);
  });

  it('404s a username-shaped path that is not a handle', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/%20' });
    expect(res.statusCode).toBe(404);
  });

  it('leaves wallet-only accounts (no username) unreachable by handle', async () => {
    const wallet = `NQ00 TEST${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
    const inserted = await getDb()
      .insert(users)
      .values({ walletAddress: wallet, role: 'buyer' })
      .returning({ id: users.id });
    userIds.push(inserted[0].id);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/nobody_here_at_all' });
    expect(res.statusCode).toBe(404);
    // The row still exists — it simply has no public handle.
    const still = await getDb().select().from(users).where(eq(users.id, inserted[0].id));
    expect(still).toHaveLength(1);
  });
});
