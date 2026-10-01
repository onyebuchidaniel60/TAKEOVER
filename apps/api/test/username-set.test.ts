// Phase 5o-A: the wallet signup username gap, and the one-time set (D25/D26).
//
// The bug this file pins: wallet signup inserts a user with NO username
// (routes/auth.ts inserts { walletAddress, role } only), and until this phase
// there was no endpoint that could ever add one — PATCH /me/profile is
// `.strict()` over {email, bio, phone, dob, location}. So 112 of 115 accounts
// were permanently handle-less, and the provider row on slot detail had
// nothing to link to. These tests use the REAL wallet signup path rather than
// hand-inserting a handle-less row, so the gap cannot reopen silently.
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, providerProfiles, sessions, slots, users } from '../../../db/schema';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';

describe.skipIf(!isDatabaseConfigured())('one-time username set (live)', () => {
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: () => true,
    rateLimit: {
      challenge: generous,
      verify: generous,
      register: generous,
      publicProfile: generous,
      usernameSet: generous,
    },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const userIds: string[] = [];
  const walletList: string[] = [];
  let walletSeq = 0;
  const uniq = (): string => `test_5oa${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1e3)}`;

  function freshWallet(): string {
    walletSeq += 1;
    walletList.push(deriveNimiqAddress(new Uint8Array(32).map((_, i) => (walletSeq * 29 + i * 11) % 256)));
    return walletList[walletList.length - 1];
  }

  type InjectResponse = Awaited<ReturnType<typeof app.inject>>;
  function code(res: InjectResponse): string {
    return (res.json() as { error: { code: string } }).error.code;
  }
  function cookieOf(res: InjectResponse): string {
    const sc = res.headers['set-cookie'];
    const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
    return list.find((c) => c.startsWith('takeover_session='))?.split(';')[0] ?? '';
  }
  async function meOf(cookie: string): Promise<{ id: string; username: string | null }> {
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    return (me.json() as { data: { user: { id: string; username: string | null } } }).data.user;
  }

  /** THE WALLET SIGNUP PATH — the exact flow that produced 112 handle-less users. */
  async function registerWalletUser(): Promise<{ id: string; username: string | null; cookie: string }> {
    const wallet = freshWallet();
    const ch = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { walletAddress: wallet },
    });
    const nonce = (ch.json() as { data: { nonce: string } }).data.nonce;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { walletAddress: wallet, nonce, signature: 'sig' },
    });
    if (res.statusCode !== 200) throw new Error(`wallet signup failed: ${res.statusCode} ${res.body}`);
    const cookie = cookieOf(res);
    const me = await meOf(cookie);
    userIds.push(me.id);
    return { id: me.id, username: me.username, cookie };
  }

  async function registerEmailUser(): Promise<{ id: string; username: string; cookie: string }> {
    const username = uniq();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email: `${username}@test.local`, password: 'audit-password-long', username },
    });
    if (res.statusCode !== 200) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    const cookie = cookieOf(res);
    const me = await meOf(cookie);
    userIds.push(me.id);
    return { id: me.id, username, cookie };
  }

  async function setUsername(cookie: string, username: unknown): Promise<InjectResponse> {
    return app.inject({
      method: 'PATCH',
      url: '/api/v1/me/username',
      headers: { ...CSRF, cookie, 'content-type': 'application/json' },
      payload: { username },
    });
  }

  afterEach(async () => {
    if (userIds.length === 0 && walletList.length === 0) return;
    const db = getDb();
    const ids = userIds.splice(0);
    const wallets = walletList.splice(0);
    if (wallets.length > 0) {
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    if (ids.length > 0) {
      // Slots first (FK), then the leaf rows, then the user.
      await db.delete(slots).where(inArray(slots.providerId, ids));
      await db.delete(sessions).where(inArray(sessions.userId, ids));
      await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
      await db.delete(providerProfiles).where(inArray(providerProfiles.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  it('REGRESSION PIN: wallet signup really does produce a handle-less account', async () => {
    // If this ever starts failing because signup began collecting a handle,
    // the gap this phase closes is gone — and the rest of the file still
    // holds, but this assertion should be revisited rather than left green.
    const user = await registerWalletUser();
    expect(user.username).toBeNull();
  });

  it('sets a handle on a handle-less wallet account and serves it on /me', async () => {
    const user = await registerWalletUser();
    const handle = uniq();
    const res = await setUsername(user.cookie, handle);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { username: string; alreadySet: boolean } }).data).toEqual({
      username: handle,
      alreadySet: false,
    });
    expect((await meOf(user.cookie)).username).toBe(handle);
  });

  it('normalizes case + whitespace, so "  MixedCase " cannot fork an identity', async () => {
    const user = await registerWalletUser();
    const res = await setUsername(user.cookie, '  MiXeD_5oa  ');
    expect(res.statusCode).toBe(200);
    // Stored lowercase — one identity, not two spellings of it.
    expect((await meOf(user.cookie)).username).toBe('mixed_5oa');
  });

  it('D26: a handle is immutable — a different value is 409 USERNAME_IMMUTABLE', async () => {
    const user = await registerWalletUser();
    const first = uniq();
    expect((await setUsername(user.cookie, first)).statusCode).toBe(200);
    const res = await setUsername(user.cookie, uniq());
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('USERNAME_IMMUTABLE');
    // The original survives the attempt.
    expect((await meOf(user.cookie)).username).toBe(first);
  });

  it('D26: re-submitting the SAME handle is an idempotent 200, not a failure', async () => {
    const user = await registerWalletUser();
    const handle = uniq();
    await setUsername(user.cookie, handle);
    const res = await setUsername(user.cookie, handle);
    expect(res.statusCode).toBe(200);
    // A dropped response must never read as "you cannot set this" — that is
    // what would strand a user who already succeeded.
    expect((res.json() as { data: { alreadySet: boolean } }).data.alreadySet).toBe(true);
  });

  it('refuses a handle already owned by another account with 409 USERNAME_TAKEN', async () => {
    const mine = await registerWalletUser();
    const theirs = await registerEmailUser();
    const res = await setUsername(mine.cookie, theirs.username);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('USERNAME_TAKEN');
  });

  it('rejects a reserved handle at the boundary, 400 and nothing written', async () => {
    const user = await registerWalletUser();
    const res = await setUsername(user.cookie, 'admin');
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe('INVALID_INPUT');
    expect((await meOf(user.cookie)).username).toBeNull();
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(21)],
    ['leading digit', '1handle'],
    ['double underscore', 'a__b'],
    ['trailing underscore', 'handle_'],
    ['uppercase-only-invalid-shape', 'Bad Handle'],
  ])('rejects a malformed handle (%s) with 400 and nothing written', async (_label, value) => {
    const user = await registerWalletUser();
    const res = await setUsername(user.cookie, value);
    expect(res.statusCode).toBe(400);
    expect((await meOf(user.cookie)).username).toBeNull();
  });

  it('rejects an empty body and a non-string with 400', async () => {
    const user = await registerWalletUser();
    expect((await setUsername(user.cookie, '')).statusCode).toBe(400);
    expect((await setUsername(user.cookie, 42)).statusCode).toBe(400);
    expect((await meOf(user.cookie)).username).toBeNull();
  });

  it('rejects unknown fields (strict) so the body cannot smuggle a second write', async () => {
    const user = await registerWalletUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/username',
      headers: { ...CSRF, cookie: user.cookie, 'content-type': 'application/json' },
      payload: { username: uniq(), email: 'smuggle@test.local' },
    });
    expect(res.statusCode).toBe(400);
    expect((await meOf(user.cookie)).username).toBeNull();
  });

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/username',
      headers: { ...CSRF, 'content-type': 'application/json' },
      payload: { username: uniq() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('audits user.username_set with the user id only — never the handle', async () => {
    const user = await registerWalletUser();
    const handle = uniq();
    await setUsername(user.cookie, handle);
    const events = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, user.id));
    const set = events.filter((e) => e.eventType === 'user.username_set');
    expect(set.length).toBe(1);
    expect(set[0]?.entityId).toBe(user.id);
    // The handle is identity data — the audit privacy rule is IDs only.
    expect(JSON.stringify(set.map((e) => e.metadata))).not.toContain(handle);
  });

  it('does NOT audit on the idempotent same-value retry (no write happened)', async () => {
    const user = await registerWalletUser();
    const handle = uniq();
    await setUsername(user.cookie, handle);
    await setUsername(user.cookie, handle);
    const events = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, user.id));
    expect(events.filter((e) => e.eventType === 'user.username_set').length).toBe(1);
  });

  it('an email user (who already chose at signup) cannot change theirs', async () => {
    const user = await registerEmailUser();
    expect(user.username).toMatch(/^test_5oa/);
    const res = await setUsername(user.cookie, uniq());
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('USERNAME_IMMUTABLE');
    expect((await meOf(user.cookie)).username).toBe(user.username);
  });

  it('THE PRODUCT BUG: once a wallet user has a handle, the provider row links', async () => {
    // The end-to-end shape of the original defect: a wallet-signed provider
    // had no handle, so SlotDetail rendered the NON-linked fallback and
    // tapping the provider name did nothing. Claim a handle, then prove the
    // public projection carries it — which is what makes the link appear.
    const user = await registerWalletUser();
    const handle = uniq();
    await setUsername(user.cookie, handle);

    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { ...CSRF, cookie: user.cookie, 'content-type': 'application/json' },
      payload: {
        title: `Provider link probe ${handle}`,
        starts_at: startsAt,
        price_usdt: '1000000',
        total_quantity: 2,
      },
    });
    expect(created.statusCode).toBe(201);
    const slotId = (created.json() as { data: { slot: { id: string } } }).data.slot.id;

    // Publish so the PUBLIC read path can see it — an unpublished slot is 404
    // for anyone but its owner, which would prove nothing about the provider
    // row. The listing fee is not configured in tests, so publish takes {}.
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/publish`,
      headers: { ...CSRF, cookie: user.cookie, 'content-type': 'application/json' },
      payload: {},
    });
    expect(published.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    expect(detail.statusCode).toBe(200);
    const slot = (detail.json() as { data: { slot: { providerUsername: string | null } } }).data.slot;
    // Before this phase this was `null` for every wallet-signed provider.
    expect(slot.providerUsername).toBe(handle);

    // And the handle actually resolves to a public profile.
    const profile = await app.inject({ method: 'GET', url: `/api/v1/users/${handle}` });
    expect(profile.statusCode).toBe(200);
  });
});