// Phase 5n-A: wallet linking.
//
// The properties that matter, in order:
//   1. an email user can attach a wallet, and /me reflects it
//   2. D21 1:1 — a wallet already on ANOTHER account is WALLET_TAKEN
//   3. a second, different wallet on the same account is refused
//   4. a bad signature / expired challenge cannot link anything
//   5. re-linking the SAME wallet is idempotent, not an error
//   6. wallet LOGIN does not let a second account take over a linked wallet
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, providerProfiles, sessions, users } from '../../../db/schema';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';

describe.skipIf(!isDatabaseConfigured())('wallet linking (live)', () => {
  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    // Accepts every signature: this file exercises the LINK logic, and
    // real signature verification is covered by the wallet auth suite.
    verifySignature: () => true,
    rateLimit: {
      challenge: generous,
      verify: generous,
      register: generous,
      login: generous,
      linkWallet: generous,
    },
  });

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };
  const userIds: string[] = [];
  const uniq = (): string => `test_5na${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  let walletSeq = 0;

  /** A distinct valid-looking wallet address per call. */
  function freshWallet(): string {
    walletSeq += 1;
    return deriveNimiqAddress(new Uint8Array(32).map((_, i) => (walletSeq * 31 + i * 7) % 256));
  }

  type InjectResponse = Awaited<ReturnType<typeof app.inject>>;

  async function registerEmailUser(): Promise<{ id: string; username: string; cookie: string }> {
    const username = uniq();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email: `${username}@test.local`, password: 'audit-password-long', username },
    });
    if (res.statusCode !== 200) throw new Error(`register failed: ${res.statusCode}`);
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookie = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!cookie) throw new Error('no session cookie');
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const id = (me.json() as { data: { user: { id: string } } }).data.user.id;
    userIds.push(id);
    return { id, username, cookie };
  }

  /** Real challenge round trip — the link endpoint consumes a real nonce. */
  async function challengeFor(walletAddress: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { walletAddress },
    });
    if (res.statusCode !== 200) throw new Error(`challenge failed: ${res.statusCode}`);
    return (res.json() as { data: { nonce: string } }).data.nonce;
  }

  async function link(cookie: string, walletAddress: string, nonce?: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/me/link-wallet',
      headers: { ...CSRF, cookie, 'content-type': 'application/json' },
      payload: {
        walletAddress,
        nonce: nonce ?? (await challengeFor(walletAddress)),
        signature: 'sig',
      },
    });
  }

  function code(res: InjectResponse): string {
    return (res.json() as { error: { code: string } }).error.code;
  }

  // Wallets created in a run are cleaned by ADDRESS: a test that links and
  // then deletes the account leaves an orphaned auth_challenges row keyed by
  // wallet, and the account id is no longer tracked.
  const freshWalletList: string[] = [];
  function track(address: string): string {
    freshWalletList.push(address);
    return address;
  }

  afterEach(async () => {
    if (userIds.length === 0 && freshWalletList.length === 0) return;
    const db = getDb();
    const ids = userIds.splice(0);
    const wallets = freshWalletList.splice(0);
    if (wallets.length > 0) {
      await db.delete(authChallenges).where(inArray(authChallenges.walletAddress, wallets));
    }
    if (ids.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, ids));
      await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
      await db.delete(providerProfiles).where(inArray(providerProfiles.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  it('links a wallet to an email account and serves it on /me', async () => {
    const user = await registerEmailUser();
    const wallet = track(freshWallet());
    const res = await link(user.cookie, wallet);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { user: { walletAddress: string | null; email: string | null } } };
    expect(body.data.user.walletAddress).toBe(wallet);
    // The email identity survives linking — this ADDS a wallet, it does not
    // convert the account.
    expect(body.data.user.email).toBe(`${user.username}@test.local`);

    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: user.cookie } });
    expect((me.json() as { data: { user: { walletAddress: string } } }).data.user.walletAddress).toBe(wallet);

    // Audit: user id only, never the wallet address.
    const events = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'user.wallet_linked'));
    const mine = events.filter((e) => e.actorUserId === user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].entityId).toBe(user.id);
    expect(JSON.stringify(mine[0].metadata ?? {})).not.toContain(wallet);
  });

  it('refuses a wallet already linked to another account (D21 WALLET_TAKEN)', async () => {
    const owner = await registerEmailUser();
    const other = await registerEmailUser();
    const wallet = track(freshWallet());
    expect((await link(owner.cookie, wallet)).statusCode).toBe(200);

    const res = await link(other.cookie, wallet);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('WALLET_TAKEN');
  });

  it('refuses a SECOND, different wallet on the same account (WALLET_ALREADY_LINKED)', async () => {
    const user = await registerEmailUser();
    const first = track(freshWallet());
    const second = track(freshWallet());
    expect((await link(user.cookie, first)).statusCode).toBe(200);
    const res = await link(user.cookie, second);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('WALLET_ALREADY_LINKED');
  });

  it('is idempotent when re-linking the SAME wallet', async () => {
    const user = await registerEmailUser();
    const wallet = track(freshWallet());
    expect((await link(user.cookie, wallet)).statusCode).toBe(200);
    // A fresh challenge, same wallet: a retry after a dropped response.
    const again = await link(user.cookie, wallet);
    expect(again.statusCode).toBe(200);
    expect((again.json() as { data: { user: { walletAddress: string } } }).data.user.walletAddress).toBe(wallet);
  });

  it('rejects a bad signature without linking anything', async () => {
    const strict = buildApp({
      verifySignature: () => false,
      rateLimit: { challenge: generous, verify: generous, register: generous, linkWallet: generous },
    });
    const username = uniq();
    const reg = await strict.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email: `${username}@test.local`, password: 'audit-password-long', username },
    });
    const sc = reg.headers['set-cookie'];
    const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
    const cookie = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0] ?? '';
    const meRes = await strict.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    userIds.push((meRes.json() as { data: { user: { id: string } } }).data.user.id);

    const wallet = track(freshWallet());
    const res = await strict.inject({
      method: 'POST',
      url: '/api/v1/me/link-wallet',
      headers: { ...CSRF, cookie, 'content-type': 'application/json' },
      payload: { walletAddress: wallet, nonce: await challengeFor(wallet), signature: 'bad' },
    });
    expect(res.statusCode).toBe(401);
    const row = await getDb().select().from(users).where(eq(users.walletAddress, wallet));
    expect(row).toHaveLength(0);
  });

  it('rejects an expired challenge', async () => {
    const user = await registerEmailUser();
    const wallet = track(freshWallet());
    const nonce = await challengeFor(wallet);
    // Age the challenge past its TTL.
    await getDb()
      .update(authChallenges)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(authChallenges.nonce, nonce));
    const res = await link(user.cookie, wallet, nonce);
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe('AUTH_EXPIRED');
  });

  it('requires authentication', async () => {
    const wallet = track(freshWallet());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/link-wallet',
      headers: { ...CSRF, 'content-type': 'application/json' },
      payload: { walletAddress: wallet, nonce: await challengeFor(wallet), signature: 'sig' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does NOT let wallet login take over an account that already linked one', async () => {
    // D21 sanity: a wallet linked to an email account must not be usable as
    // a second identity. /auth/verify loads the wallet's OWN user (the
    // linked account) — it never creates a second row, because
    // users.wallet_address is UNIQUE. The owner is the same person.
    const user = await registerEmailUser();
    const wallet = track(freshWallet());
    expect((await link(user.cookie, wallet)).statusCode).toBe(200);

    const challenge = await challengeFor(wallet);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { walletAddress: wallet, nonce: challenge, signature: 'sig' },
    });
    expect(verify.statusCode).toBe(200);
    // It resolves to the SAME account, not a new one.
    expect((verify.json() as { data: { user: { id: string } } }).data.user.id).toBe(user.id);
    const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet));
    expect(rows).toHaveLength(1);
  });
});
