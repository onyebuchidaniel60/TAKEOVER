// 1 Integration tests — live DB, fake Nimiq RPC. Auth goes through
// the real challenge/verify flow with an injected signature stub (same as
// slots-lifecycle.test.ts). Fee env is controlled per test via vi.stubEnv
// (the lifecycle reads process.env at call time). Fixtures use unique
// per-run tags; everything created here is deleted afterwards.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// File-level budget per the slots-lifecycle.test.ts precedent (remote
// Postgres wall-clock spikes, never wrong values).
vi.setConfig({ testTimeout: 30_000 });
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import type { NimiqRpcClient, TxRecord } from '../src/payments/rpc';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { auditEvents, authChallenges, claims, sessions, slots, users } from '../../../db/schema';

const FEE_NIM = '400';
const FEE_LUNA = '40000000';
const FEE_DATA = (slotId: string): string => `TAKEOVER:fee:v1:${slotId}`;

describe.skipIf(!isDatabaseConfigured())('NIM listing fee publish (live)', () => {
  // Fake chain, keyed by lowercase hash. Absent hash = unknown transaction.
  const chain = new Map<string, TxRecord>();
  const fakeRpc: NimiqRpcClient = {
    getTransactionByHash: (hash: string): Promise<TxRecord | null> =>
      Promise.resolve(chain.get(hash.toLowerCase()) ?? null),
    getBlockNumber: (): Promise<number> => Promise.resolve(200),
  };
  const stubVerifier: VerifySignatureFn = () => true;
  const app = buildApp({
    verifySignature: stubVerifier,
    rpcClient: fakeRpc,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  function randomWallet(): string {
    const wallet = deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
    wallets.push(wallet);
    return wallet;
  }

  // The fee wallet is per-test (never the owner wallet, never reused across
  // tests except where a test needs it).
  function feeWallet(): string {
    return deriveNimiqAddress(new Uint8Array(32).map(() => Math.floor(Math.random() * 256)));
  }

  function useFee(wallet: string | null): void {
    vi.stubEnv('LISTING_FEE_NIM', FEE_NIM);
    vi.stubEnv('TAKEOVER_FEE_WALLET_ADDRESS', wallet ?? '');
  }

  function useNoFee(): void {
    vi.stubEnv('LISTING_FEE_NIM', '');
    vi.stubEnv('TAKEOVER_FEE_WALLET_ADDRESS', '');
  }

  afterEach(() => {
    chain.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const found = list.find((c) => c.startsWith('takeover_session='))?.split(';')[0];
    if (!found) throw new Error('expected a session cookie');
    return found;
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

  function validDraftBody(title: string): Record<string, unknown> {
    const now = Date.now();
    const HOUR = 3_600_000;
    return {
      title,
      description: `listing-fee ${tag} description`,
      category: 'dining',
      location_label: 'Mitte',
      starts_at: new Date(now + 2 * HOUR).toISOString(),
      ends_at: new Date(now + 4 * HOUR).toISOString(),
      price_usdt: '150000',
      total_quantity: 4,
    };
  }

  async function createDraft(cookie: string, title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/slots',
      headers: { cookie, ...CSRF },
      payload: validDraftBody(title),
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { slot: { id: string } } }).data.slot.id;
    slotIds.push(id);
    return id;
  }

  function publish(
    cookie: string,
    slotId: string,
    body: Record<string, unknown>,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/publish`,
      headers: { cookie, ...CSRF },
      payload: body,
    });
  }

  // Real Nimiq hashes are 32 bytes = 64 hex chars (no 0x prefix).
  function feeHash(): string {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  function feeTx(slotId: string, owner: string, wallet: string, overrides: Partial<TxRecord> = {}): TxRecord {
    return {
      hash: feeHash(),
      sender: owner,
      recipient: wallet,
      value: FEE_LUNA,
      data: FEE_DATA(slotId),
      confirmations: 5,
      blockNumber: 100,
      ...overrides,
    };
  }

  function errorOf(res: InjectResponse): { status: number; code: string } {
    return { status: res.statusCode, code: (res.json() as { error: { code: string } }).error.code };
  }

  afterAll(async () => {
    const db = getDb();
    if (slotIds.length > 0) {
      await db.delete(claims).where(inArray(claims.slotId, slotIds));
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (wallets.length > 0) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.walletAddress, wallets));
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

  it('serves the fee state publicly on GET /config', async () => {
    useNoFee();
    const unset = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(unset.statusCode).toBe(200);
    expect((unset.json() as { data: unknown }).data).toEqual({
      listingFee: { required: false, amountNim: null, walletAddress: null },
    });

    const wallet = feeWallet();
    useFee(wallet);
    const set = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(set.statusCode).toBe(200);
    expect((set.json() as { data: unknown }).data).toEqual({
      listingFee: { required: true, amountNim: FEE_NIM, walletAddress: wallet },
    });

    useFee(null);
    const bad = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(bad.statusCode).toBe(200);
    expect((bad.json() as { data: unknown }).data).toEqual({
      listingFee: { required: true, amountNim: FEE_NIM, walletAddress: null, misconfigured: true },
    });
  });

  it('publishes without a body when no fee is configured (old behavior)', async () => {
    useNoFee();
    const cookie = await loginAs(randomWallet());
    const slotId = await createDraft(cookie, `listing-fee ${tag} nofee`);
    const res = await publish(cookie, slotId, {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.listingFeeTxHash).toBeNull();
    expect(rows[0]?.listingFeePaidAt).toBeNull();
  });

  it('publishes with a valid fee tx and records the receipt columns', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-ok`);
    const tx = feeTx(slotId, owner, wallet);
    chain.set(tx.hash, tx);
    const res = await publish(cookie, slotId, { transactionHash: tx.hash });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.listingFeeTxHash).toBe(tx.hash);
    expect(rows[0]?.listingFeePaidAt).toBeInstanceOf(Date);
  });

  it('accepts a fee paid from ANY wallet (sender is not compared)', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-anysender`);
    // A stranger's wallet pays a correct fee for the owner's slot.
    const tx = feeTx(slotId, randomWallet(), wallet);
    chain.set(tx.hash, tx);
    const res = await publish(cookie, slotId, { transactionHash: tx.hash });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { slot: { status: string } } }).data.slot.status).toBe('published');
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.listingFeeTxHash).toBe(tx.hash);
  });

  it('emits the [listing-fee-error] diagnostic on verification failure', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-diag`);
    const tx = feeTx(slotId, owner, wallet, { value: '39999999' });
    chain.set(tx.hash, tx);
    const errors: Array<unknown> = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: Array<unknown>) => {
      errors.push(args);
    });
    try {
      expect(errorOf(await publish(cookie, slotId, { transactionHash: tx.hash }))).toEqual({
        status: 409,
        code: 'PAYMENT_AMOUNT_MISMATCH',
      });
    } finally {
      spy.mockRestore();
    }
    const lines = errors
      .map((args) => (Array.isArray(args) ? args.map(String).join(' ') : String(args)))
      .filter((line) => line.includes('[listing-fee-error]'));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].replace('[listing-fee-error] ', '')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      slotId,
      txHash: tx.hash,
      reason: 'amount_mismatch',
      expectedRecipient: wallet,
      actualRecipient: wallet,
      expectedAmount: FEE_LUNA,
      actualAmount: '39999999',
    });
  });

  it('rejects a missing or malformed hash with 400 PAYMENT_INVALID_TX', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const cookie = await loginAs(randomWallet());
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-missing`);
    expect(errorOf(await publish(cookie, slotId, {}))).toEqual({
      status: 400,
      code: 'PAYMENT_INVALID_TX',
    });
    expect(errorOf(await publish(cookie, slotId, { transactionHash: 'not-hex' }))).toEqual({
      status: 400,
      code: 'PAYMENT_INVALID_TX',
    });
    expect(errorOf(await publish(cookie, slotId, { transactionHash: 'ab'.repeat(10) }))).toEqual({
      status: 400,
      code: 'PAYMENT_INVALID_TX',
    });
  });

  it('rejects unknown fields with 400 INVALID_INPUT', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const cookie = await loginAs(randomWallet());
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-strict}`);
    const tx = feeTx(slotId, randomWallet(), wallet);
    expect(
      errorOf(await publish(cookie, slotId, { transactionHash: tx.hash, role: 'admin' })),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });

  it('maps each checked field mismatch to its 409 code with no state change', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    // No sender case: the sender is intentionally not compared (see the
    // any-wallet test above).
    const cases: Array<{ name: string; overrides: Partial<TxRecord>; code: string }> = [
      { name: 'recipient', overrides: { recipient: randomWallet() }, code: 'PAYMENT_RECIPIENT_MISMATCH' },
      { name: 'amount', overrides: { value: '39999999' }, code: 'PAYMENT_AMOUNT_MISMATCH' },
      { name: 'data', overrides: { data: FEE_DATA(randomUUID()) }, code: 'PAYMENT_DATA_MISMATCH' },
    ];
    for (const { name, overrides, code } of cases) {
      const slotId = await createDraft(cookie, `listing-fee ${tag} fee-${name}`);
      const tx = feeTx(slotId, owner, wallet, overrides);
      chain.set(tx.hash, tx);
      expect(errorOf(await publish(cookie, slotId, { transactionHash: tx.hash }))).toEqual({
        status: 409,
        code,
      });
      const db = getDb();
      const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
      expect(rows[0]?.status).toBe('draft');
      expect(rows[0]?.listingFeeTxHash).toBeNull();
    }
  });

  it('maps unknown and under-confirmed hashes to retryable codes', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    const missingId = await createDraft(cookie, `listing-fee ${tag} fee-notfound`);
    expect(
      errorOf(await publish(cookie, missingId, { transactionHash: feeHash() })),
    ).toEqual({ status: 409, code: 'PAYMENT_NOT_FOUND' });
    const pendingId = await createDraft(cookie, `listing-fee ${tag} fee-pending`);
    const tx = feeTx(pendingId, owner, wallet, { confirmations: 2 });
    chain.set(tx.hash, tx);
    expect(errorOf(await publish(cookie, pendingId, { transactionHash: tx.hash }))).toEqual({
      status: 409,
      code: 'PAYMENT_NOT_CONFIRMED',
    });
  });

  it('replays a used hash with 409 PAYMENT_REPLAY and republishes idempotently', async () => {
    const wallet = feeWallet();
    useFee(wallet);
    const owner = randomWallet();
    const cookie = await loginAs(owner);
    const slotA = await createDraft(cookie, `listing-fee ${tag} fee-replay-a`);
    const tx = feeTx(slotA, owner, wallet);
    chain.set(tx.hash, tx);
    expect((await publish(cookie, slotA, { transactionHash: tx.hash })).statusCode).toBe(200);
    // Same slot + same hash: idempotent success.
    expect((await publish(cookie, slotA, { transactionHash: tx.hash })).statusCode).toBe(200);
    // Same hash on another slot: replay.
    const slotB = await createDraft(cookie, `listing-fee ${tag} fee-replay-b`);
    expect(errorOf(await publish(cookie, slotB, { transactionHash: tx.hash }))).toEqual({
      status: 409,
      code: 'PAYMENT_REPLAY',
    });
  });

  it('fails closed with 503 INTERNAL_ERROR when half-configured (F4)', async () => {
    useFee(null);
    const cookie = await loginAs(randomWallet());
    const slotId = await createDraft(cookie, `listing-fee ${tag} fee-misconfigured`);
    expect(
      errorOf(await publish(cookie, slotId, { transactionHash: feeHash() })),
    ).toEqual({ status: 503, code: 'INTERNAL_ERROR' });
    expect(errorOf(await publish(cookie, slotId, {}))).toEqual({
      status: 503,
      code: 'INTERNAL_ERROR',
    });
    const db = getDb();
    const rows = await db.select().from(slots).where(eq(slots.id, slotId)).limit(1);
    expect(rows[0]?.status).toBe('draft');
  });
});
