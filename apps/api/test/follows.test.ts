// Phase 5k-C: the follow graph.
//
// The properties that matter, in order:
//   1. follow/unfollow are IDEMPOTENT (a retried tap must not 4xx)
//   2. you cannot follow yourself (409 + a DB-level CHECK backstop)
//   3. the counts on the public profile are REAL, not placeholders
//   4. the list reads are public, and leak no private identity fields
//   5. the two mutations require auth
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { follows, auditEvents, providerProfiles, sessions, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('follows (live)', () => {
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: () => true,
    rateLimit: {
      challenge: generous,
      verify: generous,
      // This file mints ~14 accounts; the production 5/hour register budget
      // would 429 the fixtures themselves.
      register: generous,
      publicProfile: generous,
      mutate: generous,
      list: generous,
    },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  /** Credentialed request headers: CSRF pair + session cookie. */
  const authed = (cookie: string) => ({ ...CSRF, cookie });
  const userIds: string[] = [];
  const uniq = (): string => `test_5kc${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  async function makeUser(): Promise<{ id: string; username: string; cookie: string }> {
    // Register through the real endpoint (it owns the session mint), then
    // backfill the PRIVATE fields so the list-read privacy assertion has
    // something real to prove it does not leak.
    const username = uniq();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email: `${username}@test.local`, password: 'audit-password-long', username },
    });
    if (reg.statusCode !== 200) throw new Error(`register failed: ${reg.statusCode}`);
    const setCookie = reg.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookie = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!cookie) throw new Error('no session cookie');

    const db = getDb();
    const updated = await db
      .update(users)
      .set({ phone: '+49 170 0000000', dob: '1991-02-03', bio: 'follow test bio' })
      .where(eq(users.username, username))
      .returning({ id: users.id, username: users.username });
    userIds.push(updated[0].id);
    return { id: updated[0].id, username: updated[0].username as string, cookie };
  }

  async function profileOf(username: string): Promise<{ stats: Record<string, number> }> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${username}` });
    return (res.json() as { data: { profile: { stats: Record<string, number> } } }).data.profile;
  }

  afterEach(async () => {
    if (userIds.length === 0) return;
    const db = getDb();
    const ids = userIds.splice(0);
    await db.delete(follows).where(inArray(follows.followerId, ids));
    await db.delete(follows).where(inArray(follows.followingId, ids));
    // register mints a session and writes an audit event, both of which
    // reference users; they must go before the user rows.
    await db.delete(sessions).where(inArray(sessions.userId, ids));
    await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
    await db.delete(providerProfiles).where(inArray(providerProfiles.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });

  it('follows, is idempotent, and reports the real counts', async () => {
    const me = await makeUser();
    const them = await makeUser();

    expect((await profileOf(them.username)).stats.followers).toBe(0);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { following: boolean } }).data.following).toBe(true);

    // Idempotent: a second identical POST is still 200, not a 4xx.
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    expect(second.statusCode).toBe(200);

    // The UNIQUE constraint, not just the handler, kept it to one edge.
    const edges = await getDb().select().from(follows);
    expect(edges.filter((e) => e.followerId === me.id && e.followingId === them.id)).toHaveLength(1);

    expect((await profileOf(them.username)).stats.followers).toBe(1);
    expect((await profileOf(me.username)).stats.following).toBe(1);

    // Audit: one user.followed row, IDs only. The idempotent second POST
    // must NOT add a second event, or the log overstates what happened.
    const events = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, me.id), eq(auditEvents.eventType, 'user.followed')));
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe(them.id);
    expect(events[0].metadata).toMatchObject({ followerId: me.id, followingId: them.id });
    const meta = JSON.stringify(events[0].metadata);
    expect(meta).not.toContain('@test.local');
    expect(meta).not.toContain('+49 170');
  });

  it('audits an unfollow and leaves no event for a no-op', async () => {
    const me = await makeUser();
    const them = await makeUser();
    await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
    });
    // Second delete changes nothing, so it must not log anything either.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
    });
    const unfollowed = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, me.id), eq(auditEvents.eventType, 'user.unfollowed')));
    expect(unfollowed).toHaveLength(1);
  });

  it('unfollows, is idempotent, and drops the counts', async () => {
    const me = await makeUser();
    const them = await makeUser();
    await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { data: { following: boolean } }).data.following).toBe(false);

    // Unfollowing again is a 200 no-op, not a 404.
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
    });
    expect(again.statusCode).toBe(200);
    expect((await profileOf(them.username)).stats.followers).toBe(0);
  });

  it('refuses a self-follow with 409 CANNOT_FOLLOW_SELF', async () => {
    const me = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${me.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CANNOT_FOLLOW_SELF');
  });

  it('rejects a self-follow at the DB level too (CHECK backstop)', async () => {
    const me = await makeUser();
    // Bypasses the endpoint entirely: the invariant must not live only in
    // the handler.
    await expect(
      getDb().insert(follows).values({ followerId: me.id, followingId: me.id }),
    ).rejects.toThrow();
  });

  it('404s an unknown handle and 401s a guest mutation', async () => {
    const me = await makeUser();
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/users/nobody_at_all_here/follow',
      headers: authed(me.cookie),
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);

    const guest = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${me.username}/follow`,
      headers: CSRF,
      payload: {},
    });
    expect(guest.statusCode).toBe(401);
  });

  it('serves follower/following lists publicly, with no private fields', async () => {
    const me = await makeUser();
    const them = await makeUser();
    const followRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    expect(followRes.statusCode).toBe(200);

    // No cookie at all: the read is public.
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${them.username}/followers` });
    expect(res.statusCode).toBe(200);
    const followers = (res.json() as { data: { followers: Record<string, unknown>[] } }).data.followers;
    expect(followers).toHaveLength(1);
    expect(followers[0].username).toBe(me.username);
    // Guest viewer: isFollowing is null, not a misleading false.
    expect(followers[0].isFollowing).toBeNull();

    // Authenticated viewer. isFollowing means "does the VIEWER follow THIS
    // entry", and in a followers list the entry IS the viewer — so the
    // correct answer here is false, not true.
    const asViewer = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${them.username}/followers`,
      headers: { cookie: me.cookie },
    });
    const viewerList = (asViewer.json() as { data: { followers: Record<string, unknown>[] } }).data.followers;
    expect(viewerList[0].isFollowing).toBe(false);

    // The reverse direction is the other user's out-edge, and there the
    // viewer DOES follow the entry.
    const following = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${me.username}/following`,
      headers: { cookie: me.cookie },
    });
    const outEdges = (following.json() as { data: { following: Record<string, unknown>[] } }).data.following;
    expect(outEdges.map((e) => e.username)).toEqual([them.username]);
    expect(outEdges[0].isFollowing).toBe(true);

    // A third party follows nobody here yet.
    const stranger = await makeUser();
    const asStranger = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${them.username}/followers`,
      headers: { cookie: stranger.cookie },
    });
    const strangerList = (asStranger.json() as { data: { followers: Record<string, unknown>[] } }).data.followers;
    expect(strangerList[0].isFollowing).toBe(false);

    // No private identity field reaches the list.
    const html = JSON.stringify(followers);
    for (const forbidden of ['+49 170 0000000', '1991-02-03', 'follow test bio', 'test.local']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('cascades the edge away when an account is deleted', async () => {
    const me = await makeUser();
    const them = await makeUser();
    await app.inject({
      method: 'POST',
      url: `/api/v1/users/${them.username}/follow`,
      headers: authed(me.cookie),
      payload: {},
    });
    // Drop the FK-tracking ids so afterEach does not also delete this user.
    const idx = userIds.indexOf(them.id);
    if (idx >= 0) userIds.splice(idx, 1);
    // Its session + audit rows reference the user; clear those first so the
    // delete below is testing the FOLLOW cascade, not tripping another FK.
    await getDb().delete(sessions).where(eq(sessions.userId, them.id));
    await getDb().delete(auditEvents).where(eq(auditEvents.actorUserId, them.id));
    await getDb().delete(users).where(eq(users.id, them.id));
    const left = await getDb().select().from(follows).where(eq(follows.followingId, them.id));
    expect(left).toHaveLength(0);
  });
});
