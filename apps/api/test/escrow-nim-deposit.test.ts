// Phase 14f P-NIM-1: NIM escrow deposit integration (live DB).
// Auth goes through the real challenge/verify flow with an injected
// signature stub. NIM chain reads go through a stubbed global fetch
// serving canned Nimiq JSON-RPC envelopes (wire shapes mirror rpc.ts's
// documented live format). The Polygon escrow client is an unused fake:
// the route only needs one injected (NIM branches never call it).
// Fresh claims per test keep limiters isolated.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { nimDepositDataBinding } from '../src/escrow/nimiq/verify-deposit';
import type { EscrowContractClient } from '../../../packages/shared/src/escrow/contract';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import {
  auditEvents,
  authChallenges,
  claims,
  escrowLedger,
  escrows,
  sessions,
  slots,
  users,
} from '../../../db/schema';

const ESCROW_WALLET = deriveNimiqAddress(new Uint8Array(32).fill(42));
const SLOT_PRICE = 1500000n;
const HOUR = 3_600_000;

interface CannedTx {
  hash: string;
  from: string;
  to: string;
  value: number;
  dataUtf8: string;
  confirmations: number;
}

function wireTx(tx: CannedTx): Record<string, unknown> {
  return {
    hash: tx.hash,
    blockNumber: 11_000_000,
    timestamp: 1,
    confirmations: tx.confirmations,
    size: 1,
    relatedAddresses: [],
    from: tx.from,
    fromType: 0,
    to: tx.to,
    toType: 0,
    value: tx.value,
    fee: 1,
    senderData: '',
    recipientData: Buffer.from(tx.dataUtf8, 'utf8').toString('hex'),
    flags: 0,
    validityStartHeight: 1,
    proof: '',
    networkId: 1,
    executionResult: true,
  };
}

describe.skipIf(!isDatabaseConfigured())('NIM escrow deposit (live DB, stubbed Nimiq RPC)', () => {
  const stubVerifier: VerifySignatureFn = () => true;

  const txByHash = new Map<string, CannedTx>();
  let fetchBroken = false;

  const escrowClient: EscrowContractClient = {
    async getDepositEvent() {
      return null;
    },
    async getDisputeEvent() {
      return null;
    },
    async getTransactionReceipt() {
      return null;
    },
    async release() {
      throw new Error('P-NIM-2');
    },
    async refund() {
      throw new Error('P-NIM-2');
    },
  };

  const app = buildApp({
    verifySignature: stubVerifier,
    escrowClient,
    rateLimit: {
      challenge: { windowMs: 60_000, max: 1000 },
      verify: { windowMs: 60_000, max: 1000 },
      intent: { windowMs: 60_000, max: 1000 },
      submission: { windowMs: 60_000, max: 1000 },
      claimCreate: { windowMs: 60_000, max: 1000 },
      escrowIntent: { windowMs: 60_000, max: 1000 },
      escrowSubmission: { windowMs: 60_000, max: 1000 },
      verifyDeposit: { windowMs: 0 },
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  function freshTxHash(): string {
    return 'ab'.repeat(16) + randomUUID().replace(/-/g, '').slice(0, 32);
  }

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
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, wallet)).limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlot(providerWallet: string): Promise<string> {
    const db = getDb();
    const providerCookie = await loginAs(providerWallet);
    const providerId = await userIdFor(providerWallet);
    void providerCookie;
    const now = Date.now();
    const id = randomUUID();
    await db.insert(slots).values({
      id,
      providerId,
      title: `NIM ${tag} slot`,
      description: `NIM ${tag} description`,
      category: 'dining',
      locationLabel: 'Mitte',
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      priceNim: SLOT_PRICE,
      totalQuantity: 4,
      availableQuantity: 4,
      payoutWallet: providerWallet,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function intentAs(cookie: string, claimId: string, token: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie, ...CSRF },
      payload: { token },
    });
  }

  async function claimAs(cookie: string, slotId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { claim: { id: string } } }).data.claim.id;
  }

  async function submitAs(cookie: string, claimId: string, txHash: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-submission`,
      headers: { cookie, ...CSRF },
      payload: { transactionHash: txHash },
    });
  }

  async function verifyAs(cookie: string, claimId: string): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/verify-deposit`,
      headers: { cookie, ...CSRF },
      payload: {},
    });
  }

  function programDeposit(txHash: string, tx: Omit<CannedTx, 'hash'>): void {
    txByHash.set(txHash.toLowerCase(), { ...tx, hash: txHash });
  }

  beforeAll(() => {
    savedEnv.NIM_ESCROW_WALLET_ADDRESS = process.env.NIM_ESCROW_WALLET_ADDRESS;
    process.env.NIM_ESCROW_WALLET_ADDRESS = ESCROW_WALLET;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        if (fetchBroken) {
          throw new Error('network down');
        }
        const reqBody = JSON.parse(String((init?.body as string) ?? '{}')) as {
          method?: string;
          params?: unknown[];
          id?: unknown;
        };
        if (reqBody.method === 'getBlockNumber') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ jsonrpc: '2.0', result: { data: 12_000_000, metadata: null }, id: 1 }),
          };
        }
        if (reqBody.method === 'getTransactionByHash') {
          const hash = String((reqBody.params as string[])?.[0] ?? '');
          const found = txByHash.get(hash.toLowerCase());
          if (!found) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal error', data: `Transaction not found: ${hash}` },
                id: 1,
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ jsonrpc: '2.0', result: { data: wireTx(found), metadata: null }, id: 1 }),
          };
        }
        throw new Error(`unexpected RPC method in test: ${String(reqBody.method)}`);
      }),
    );
  });

  afterEach(() => {
    txByHash.clear();
    fetchBroken = false;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (savedEnv.NIM_ESCROW_WALLET_ADDRESS === undefined) {
      delete process.env.NIM_ESCROW_WALLET_ADDRESS;
    } else {
      process.env.NIM_ESCROW_WALLET_ADDRESS = savedEnv.NIM_ESCROW_WALLET_ADDRESS;
    }
    const db = getDb();
    if (slotIds.length > 0) {
      const claimRows = await db.select({ id: claims.id }).from(claims).where(inArray(claims.slotId, slotIds));
      const claimIds = claimRows.map((c) => c.id);
      if (claimIds.length > 0) {
        const escrowRows = await db.select({ id: escrows.id }).from(escrows).where(inArray(escrows.claimId, claimIds));
        const escrowIds = escrowRows.map((e) => e.id);
        if (escrowIds.length > 0) {
          await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...claimIds, ...escrowIds]));
          await db.delete(escrowLedger).where(inArray(escrowLedger.escrowId, escrowIds));
        }
        await db.delete(escrows).where(inArray(escrows.claimId, claimIds));
      }
      await db.delete(claims).where(inArray(claims.slotId, slotIds));
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
  });

  async function nimSetup(): Promise<{ cookie: string; buyerId: string; buyerWallet: string; claimId: string }> {
    const buyerWallet = randomWallet();
    const cookie = await loginAs(buyerWallet);
    const buyerId = await userIdFor(buyerWallet);
    const slotId = await makeSlot(randomWallet());
    const claimId = await claimAs(cookie, slotId);
    return { cookie, buyerId, buyerWallet, claimId };
  }

  it('NIM intent returns the NIM instruction and creates a NULL-contract row', async () => {
    const { cookie, claimId, buyerWallet } = await nimSetup();
    const res = await intentAs(cookie, claimId, 'NIM');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        escrow: { payment_token: string; status: string; contract_address: unknown; on_chain_escrow_id: unknown };
        depositInstruction: Record<string, unknown>;
      };
    };
    expect(body.data.escrow.payment_token).toBe('NIM');
    expect(body.data.escrow.status).toBe('created');
    expect(body.data.escrow.contract_address).toBeNull();
    expect(body.data.escrow.on_chain_escrow_id).toBeNull();
    expect(body.data.depositInstruction).toEqual({
      escrowWalletAddress: ESCROW_WALLET,
      nimAmount: SLOT_PRICE.toString(),
      dataBinding: nimDepositDataBinding(claimId),
      buyerWallet,
    });
    const db = getDb();
    const rows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.paymentToken).toBe('NIM');
    expect(rows[0]?.contractAddress).toBeNull();
    expect(rows[0]?.onChainEscrowId).toBeNull();
  });

  it('NIM intent is idempotent pre-funding (same instruction, one row)', async () => {
    const { cookie, claimId } = await nimSetup();
    const first = await intentAs(cookie, claimId, 'NIM');
    const second = await intentAs(cookie, claimId, 'NIM');
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    const db = getDb();
    const rows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(rows).toHaveLength(1);
  });

  it('NIM intent without a configured wallet → 503 with no row', async () => {
    const { cookie, claimId } = await nimSetup();
    delete process.env.NIM_ESCROW_WALLET_ADDRESS;
    try {
      const res = await intentAs(cookie, claimId, 'NIM');
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_CONTRACT_UNAVAILABLE');
    } finally {
      process.env.NIM_ESCROW_WALLET_ADDRESS = ESCROW_WALLET;
    }
    const db = getDb();
    const rows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(rows).toHaveLength(0);
  });

  it('happy path funds the escrow and writes exactly one ledger row', async () => {
    const db = getDb();
    const { cookie, buyerId, buyerWallet, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    const txHash = freshTxHash();
    expect((await submitAs(cookie, claimId, txHash)).statusCode).toBe(200);
    programDeposit(txHash, {
      from: buyerWallet,
      to: ESCROW_WALLET,
      value: Number(SLOT_PRICE),
      dataUtf8: nimDepositDataBinding(claimId),
      confirmations: 5,
    });
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('funded');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(escrowRows).toHaveLength(1);
    expect(escrowRows[0]?.status).toBe('funded');
    expect(escrowRows[0]?.depositTxHash).toBe(txHash);
    expect(escrowRows[0]?.fundedAt).toBeInstanceOf(Date);
    expect(escrowRows[0]?.deliveryDeadline).toBeInstanceOf(Date);
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('escrow_funded');
    const ledgerRows = await db.select().from(escrowLedger).where(eq(escrowLedger.escrowId, escrowRows[0]?.id as string));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe('deposit');
    expect(ledgerRows[0]?.debitAccount).toBe(`buyer:user:${buyerId}`);
    expect(ledgerRows[0]?.creditAccount).toBe('escrow:wallet');
    expect(ledgerRows[0]?.amountBaseUnits).toBe(SLOT_PRICE);
    expect(ledgerRows[0]?.txHash).toBe(txHash);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, claimId), eq(auditEvents.eventType, 'escrow.funded')));
    expect(audits).toHaveLength(1);
  });

  it.each<[string, { from?: string; to?: string; value?: number; dataUtf8?: string }, string]>([
    ['sender', { from: 'SENDER' }, 'sender_mismatch'],
    ['amount', { value: Number(SLOT_PRICE) + 1 }, 'amount_mismatch'],
    ['data', { dataUtf8: 'TAKEOVER:v1:wrong' }, 'data_mismatch'],
    ['recipient', { to: 'RECIPIENT' }, 'recipient_mismatch'],
  ])('%s problem → mismatch with reason, no state change, no ledger row', async (_label, tweak, reason) => {
    const db = getDb();
    const { cookie, buyerWallet, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    const txHash = freshTxHash();
    expect((await submitAs(cookie, claimId, txHash)).statusCode).toBe(200);
    const from = tweak.from === 'SENDER' ? deriveNimiqAddress(new Uint8Array(32).fill(99)) : buyerWallet;
    const to = tweak.to === 'RECIPIENT' ? deriveNimiqAddress(new Uint8Array(32).fill(100)) : ESCROW_WALLET;
    programDeposit(txHash, {
      from,
      to,
      value: tweak.value ?? Number(SLOT_PRICE),
      dataUtf8: tweak.dataUtf8 ?? nimDepositDataBinding(claimId),
      confirmations: 5,
    });
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; reason?: string } };
    expect(body.data.status).toBe('mismatch');
    expect(body.data.reason).toBe(reason);
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('deposit_submitted');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(escrowRows[0]?.status).toBe('created');
    const ledgerRows = await db.select().from(escrowLedger).where(eq(escrowLedger.escrowId, escrowRows[0]?.id as string));
    expect(ledgerRows).toHaveLength(0);
  });

  it('unknown deposit hash → pending', async () => {
    const { cookie, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    expect((await submitAs(cookie, claimId, freshTxHash())).statusCode).toBe(200);
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('pending');
  });

  it('under-confirmations → pending', async () => {
    const { cookie, buyerWallet, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    const txHash = freshTxHash();
    expect((await submitAs(cookie, claimId, txHash)).statusCode).toBe(200);
    programDeposit(txHash, {
      from: buyerWallet,
      to: ESCROW_WALLET,
      value: Number(SLOT_PRICE),
      dataUtf8: nimDepositDataBinding(claimId),
      confirmations: 2,
    });
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('pending');
  });

  it('already funded → 200 no-op without a second ledger row', async () => {
    const db = getDb();
    const { cookie, buyerWallet, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    const txHash = freshTxHash();
    expect((await submitAs(cookie, claimId, txHash)).statusCode).toBe(200);
    programDeposit(txHash, {
      from: buyerWallet,
      to: ESCROW_WALLET,
      value: Number(SLOT_PRICE),
      dataUtf8: nimDepositDataBinding(claimId),
      confirmations: 5,
    });
    expect(((await verifyAs(cookie, claimId)).json() as { data: { status: string } }).data.status).toBe('funded');
    const again = await verifyAs(cookie, claimId);
    expect(again.statusCode).toBe(200);
    expect((again.json() as { data: { status: string } }).data.status).toBe('funded');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    const ledgerRows = await db.select().from(escrowLedger).where(eq(escrowLedger.escrowId, escrowRows[0]?.id as string));
    expect(ledgerRows).toHaveLength(1);
  });

  it('expired window + pending → payment_review', async () => {
    const db = getDb();
    const { cookie, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    expect((await submitAs(cookie, claimId, freshTxHash())).statusCode).toBe(200);
    await db
      .update(claims)
      .set({ depositSubmittedAt: new Date(Date.now() - 2000 * 1000) })
      .where(eq(claims.id, claimId));
    const res = await verifyAs(cookie, claimId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('review');
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('payment_review');
  });

  it('NIM RPC outage → 503 with state unchanged', async () => {
    const db = getDb();
    const { cookie, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    expect((await submitAs(cookie, claimId, freshTxHash())).statusCode).toBe(200);
    fetchBroken = true;
    try {
      const res = await verifyAs(cookie, claimId);
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('ESCROW_CONTRACT_UNAVAILABLE');
    } finally {
      fetchBroken = false;
    }
    const claimRows = await db.select().from(claims).where(eq(claims.id, claimId));
    expect(claimRows[0]?.status).toBe('deposit_submitted');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    expect(escrowRows[0]?.status).toBe('created');
  });

  it('two parallel verifies → funded twice, exactly one ledger row', async () => {
    const db = getDb();
    const { cookie, buyerWallet, claimId } = await nimSetup();
    expect((await intentAs(cookie, claimId, 'NIM')).statusCode).toBe(200);
    const txHash = freshTxHash();
    expect((await submitAs(cookie, claimId, txHash)).statusCode).toBe(200);
    programDeposit(txHash, {
      from: buyerWallet,
      to: ESCROW_WALLET,
      value: Number(SLOT_PRICE),
      dataUtf8: nimDepositDataBinding(claimId),
      confirmations: 5,
    });
    const [a, b] = await Promise.all([verifyAs(cookie, claimId), verifyAs(cookie, claimId)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { data: { status: string } }).data.status).toBe('funded');
    expect((b.json() as { data: { status: string } }).data.status).toBe('funded');
    const escrowRows = await db.select().from(escrows).where(eq(escrows.claimId, claimId));
    const ledgerRows = await db.select().from(escrowLedger).where(eq(escrowLedger.escrowId, escrowRows[0]?.id as string));
    expect(ledgerRows).toHaveLength(1);
  });
});
