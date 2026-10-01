// Phase 5n-D: multi-quantity claims.
//
// The invariant under test is CONSERVATION: a slot's total is fixed, and
// every path that removes units must be able to put the same number back. So
// the suite is organised around "N units went out — can N come back", plus
// the concurrency cases where two buyers want overlapping units from the
// same pool and the row lock has to serialize them.
//
// The concurrency tests are the ones that matter most. The single-unit era
// made almost every race trivially safe (two buyers on 1 available: exactly
// one wins). With quantity, a buyer can ask for MORE than a rival takes in
// total, so a check like `available > 0` would let both through and oversell
// the slot. The bound is therefore `quantity <= availableQuantity`, evaluated
// under the lock, and these three cases pin it.
//
// Auth goes through the real challenge/verify flow with an injected signature
// stub. Everything created is deleted in afterAll.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { deriveNimiqAddress } from '../src/auth/nimiq-address';
import type { VerifySignatureFn } from '../src/auth/nimiq-verify';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import {
  auditEvents,
  authChallenges,
  claims,
  escrows,
  escrowLedger,
  paymentIntents,
  sessions,
  slots,
  users,
} from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('multi-quantity claims (live)', () => {
  // The escrow intent fail-closes without a contract and a token address
  // (503 ESCROW_NOT_CONFIGURED), so both are pinned before the app is built.
  // Only the AMOUNT is under test here — no chain call is made.
  process.env.USDT_ESCROW_CONTRACT_ADDRESS = '0x5555555555555555555555555555555555555555';
  process.env.USDT_TOKEN_ADDRESS = '0x6666666666666666666666666666666666666666';

  const generous = { windowMs: 60_000, max: 1000 };
  const app = buildApp({
    verifySignature: (() => true) as VerifySignatureFn,
    rateLimit: {
      challenge: generous,
      verify: generous,
      claimCreate: generous,
      slotCreate: generous,
      slotMutate: generous,
      providerClaims: generous,
    },
  });

  const tag = randomUUID().slice(0, 8);
  const wallets: string[] = [];
  const slotIds: string[] = [];
  const HOUR = 3_600_000;
  const CSRF = { origin: 'http://localhost:5173', 'x-takeover-client': 'web' };

  function randomWallet(): string {
    const publicKey = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const wallet = deriveNimiqAddress(publicKey);
    wallets.push(wallet);
    return wallet;
  }

  type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

  function sessionCookieFrom(res: InjectResponse): string {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
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
    const rows = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, wallet))
      .limit(1);
    if (!rows[0]) throw new Error('expected user row');
    return rows[0].id;
  }

  async function makeSlot(
    opts: { total?: number; available?: number; priceUsdt?: bigint; providerWallet?: string } = {},
  ): Promise<string> {
    const db = getDb();
    // The provider must be a REAL canonical Nimiq address here, not the
    // `NQ00 <marker>` style other suites use for a never-authenticating
    // fixture. Two tests need to log in AS the provider (the own-slot guard,
    // the wallet-less gate's sibling), and a marker address fails IBAN
    // canonicalization — it never gets a session at all.
    const providerWallet = opts.providerWallet ?? randomWallet();
    // Always insert: randomWallet() has ALREADY pushed this address into
    // `wallets`, so a membership guard would skip the insert and the row would
    // never exist. onConflictDoNothing makes the repeat harmless.
    await db.insert(users).values({ walletAddress: providerWallet, role: 'buyer' }).onConflictDoNothing();
    const providerId = await userIdFor(providerWallet);
    const id = randomUUID();
    const total = opts.total ?? 4;
    await db.insert(slots).values({
      id,
      providerId,
      title: `P5od ${tag} slot`,
      description: `P5od ${tag} description`,
      startsAt: new Date(Date.now() + 2 * HOUR),
      endsAt: new Date(Date.now() + 4 * HOUR),
      priceUsdt: opts.priceUsdt ?? 150000n,
      totalQuantity: total,
      availableQuantity: opts.available ?? total,
      status: 'published',
      publishedAt: new Date(),
    });
    slotIds.push(id);
    return id;
  }

  async function postClaim(
    cookie: string,
    slotId: string,
    payload: Record<string, unknown> = {},
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/slots/${slotId}/claims`,
      headers: { cookie, ...CSRF, 'content-type': 'application/json' },
      payload,
    });
  }

  async function readSlot(slotId: string): Promise<typeof slots.$inferSelect> {
    const rows = await getDb().select().from(slots).where(eq(slots.id, slotId)).limit(1);
    if (!rows[0]) throw new Error('expected slot row');
    return rows[0];
  }

  async function readClaims(slotId: string): Promise<(typeof claims.$inferSelect)[]> {
    return getDb().select().from(claims).where(eq(claims.slotId, slotId));
  }

  function code(res: InjectResponse): string {
    return (res.json() as { error: { code: string } }).error.code;
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
        const escrowRows = await db
          .select({ id: escrows.id })
          .from(escrows)
          .where(inArray(escrows.claimId, claimIds));
        const escrowIds = escrowRows.map((e) => e.id);
        if (escrowIds.length > 0) {
          await db.delete(escrowLedger).where(inArray(escrowLedger.escrowId, escrowIds));
        }
        await db.delete(escrows).where(inArray(escrows.claimId, claimIds));
        await db.delete(paymentIntents).where(inArray(paymentIntents.claimId, claimIds));
      }
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
  });

  // -- shape / bounds ------------------------------------------------------

  it('quantity 1 is unchanged (regression — the pre-5n-D call)', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 4, available: 4 });
    const res = await postClaim(cookie, slotId);
    expect(res.statusCode).toBe(200);
    const claim = (res.json() as { data: { claim: { quantity: number } } }).data.claim;
    expect(claim.quantity).toBe(1);
    expect((await readSlot(slotId)).availableQuantity).toBe(3);
  });

  it('an absent quantity field means 1 (older clients send {})', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 2, available: 2 });
    const res = await postClaim(cookie, slotId, {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { quantity: number } } }).data.claim.quantity).toBe(1);
  });

  it('quantity 3 on a slot with 5 succeeds and drops availability by 3', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    const res = await postClaim(cookie, slotId, { quantity: 3 });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { claim: { quantity: number } } }).data.claim.quantity).toBe(3);
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
  });

  it('claiming exactly the remaining units flips the slot to sold_out', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    const res = await postClaim(cookie, slotId, { quantity: 3 });
    expect(res.statusCode).toBe(200);
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(0);
    expect(row.status).toBe('sold_out');
  });

  it('quantity above availability is 409 SLOT_UNAVAILABLE, and nothing moves', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    const res = await postClaim(cookie, slotId, { quantity: 5 });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('SLOT_UNAVAILABLE');
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(3);
    expect(await readClaims(slotId)).toHaveLength(0);
  });

  it('a single-unit slot refuses quantity 2 — availability is the only bound', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 1, available: 1 });
    const res = await postClaim(cookie, slotId, { quantity: 2 });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('SLOT_UNAVAILABLE');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN-adjacent string', '3'],
  ])('rejects quantity %s with 400 and writes nothing', async (_label, quantity) => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 4, available: 4 });
    const res = await postClaim(cookie, slotId, { quantity });
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe('INVALID_INPUT');
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
    expect(await readClaims(slotId)).toHaveLength(0);
  });

  it('rejects an unknown field (strict) so the body cannot carry a second write', async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 4, available: 4 });
    const res = await postClaim(cookie, slotId, { quantity: 2, price_usdt: '1' });
    expect(res.statusCode).toBe(400);
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
  });

  // -- concurrency (the heart of 5n-D) -------------------------------------

  it('CASE 1: two buyers race for 2 and 2 of 3 — one wins, one gets 409', { timeout: 30_000 }, async () => {
    const a = await loginAs(randomWallet());
    const b = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    // Fired together: whichever transaction takes the row lock second
    // re-reads the reduced availability and must refuse.
    const [ra, rb] = await Promise.all([
      postClaim(a, slotId, { quantity: 2 }),
      postClaim(b, slotId, { quantity: 2 }),
    ]);
    const statuses = [ra.statusCode, rb.statusCode].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = ra.statusCode === 409 ? ra : rb;
    expect(code(loser)).toBe('SLOT_UNAVAILABLE');
    // Conservation: 2 taken, 2 still free, and only ONE claim exists.
    expect((await readSlot(slotId)).availableQuantity).toBe(1);
    const rows = await readClaims(slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(2);
  });

  it('CASE 2a: quantity 3 wins the lock, then quantity 1 is refused on 0 left', { timeout: 30_000 }, async () => {
    const a = await loginAs(randomWallet());
    const b = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    // Sequential, so the ORDER is pinned: the exact fit goes first.
    const first = await postClaim(a, slotId, { quantity: 3 });
    expect(first.statusCode).toBe(200);
    const second = await postClaim(b, slotId, { quantity: 1 });
    expect(second.statusCode).toBe(409);
    expect(code(second)).toBe('SLOT_UNAVAILABLE');
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(0);
    expect(row.status).toBe('sold_out');
    expect(await readClaims(slotId)).toHaveLength(1);
  });

  it('CASE 2b: quantity 1 goes first, then 3 is REFUSED with only 2 left', { timeout: 30_000 }, async () => {
    // This is the case that actually distinguishes the correct rule from the
    // wrong one. A check of `availableQuantity > 0` would let this 3-unit
    // claim through against 2 remaining, leaving 1 available while 3 units
    // are held — four units out of a three-unit slot. The bound has to be
    // `quantity <= availableQuantity`, evaluated under the lock.
    const a = await loginAs(randomWallet());
    const b = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    const first = await postClaim(a, slotId, { quantity: 1 });
    expect(first.statusCode).toBe(200);
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
    const second = await postClaim(b, slotId, { quantity: 3 });
    expect(second.statusCode).toBe(409);
    expect(code(second)).toBe('SLOT_UNAVAILABLE');
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(2);
    // Conservation holds: 1 held + 2 free == 3 total.
    expect(row.totalQuantity).toBe(3);
    const rows = await readClaims(slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quantity).toBe(1);
  });

  it('CASE 3: quantities 2 and 1 on 3 — both fit, both claims exist', { timeout: 30_000 }, async () => {
    const a = await loginAs(randomWallet());
    const b = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3 });
    const [ra, rb] = await Promise.all([
      postClaim(a, slotId, { quantity: 2 }),
      postClaim(b, slotId, { quantity: 1 }),
    ]);
    // Order does not matter: 2+1 == 3 either way round.
    expect([ra.statusCode, rb.statusCode].sort((x, y) => x - y)).toEqual([200, 200]);
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(0);
    expect(row.status).toBe('sold_out');
    const rows = await readClaims(slotId);
    expect(rows).toHaveLength(2);
    // And the quantities survived the race intact.
    expect(rows.map((r) => r.quantity).sort()).toEqual([1, 2]);
  });

  it('NEVER oversells: five buyers race for 2 of 3 — at most one claim, never negative', { timeout: 60_000 }, async () => {
    const cookies = await Promise.all([0, 1, 2, 3, 4].map(() => loginAs(randomWallet())));
    const slotId = await makeSlot({ total: 3, available: 3 });
    const results = await Promise.all(
      cookies.map((cookie) => postClaim(cookie, slotId, { quantity: 2 })),
    );
    const wins = results.filter((r) => r.statusCode === 200);
    expect(wins).toHaveLength(1);
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(1);
    // The invariant that must never break: 0 <= available <= total.
    expect(row.availableQuantity).toBeGreaterThanOrEqual(0);
    expect(row.availableQuantity).toBeLessThanOrEqual(row.totalQuantity);
  });

  // -- idempotency ---------------------------------------------------------

  it('a repeat claim returns the SAME claim and never double-decrements', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    const first = await postClaim(cookie, slotId, { quantity: 2 });
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { data: { claim: { id: string; quantity: number } } }).data.claim;
    const second = await postClaim(cookie, slotId, { quantity: 2 });
    expect(second.statusCode).toBe(200);
    const secondClaim = (second.json() as { data: { claim: { id: string; quantity: number } } }).data.claim;
    expect(secondClaim.id).toBe(firstId.id);
    // FR-05: the existing live claim comes back untouched. Silently topping a
    // live hold up to a new quantity would be a money action nobody asked for,
    // so the quantity the buyer already holds is what they get back.
    expect(secondClaim.quantity).toBe(2);
    expect((await readSlot(slotId)).availableQuantity).toBe(3);
    expect(await readClaims(slotId)).toHaveLength(1);
  });

  it('a repeat claim with a DIFFERENT quantity still returns the original claim', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    await postClaim(cookie, slotId, { quantity: 2 });
    const res = await postClaim(cookie, slotId, { quantity: 4 });
    expect(res.statusCode).toBe(200);
    const claim = (res.json() as { data: { claim: { quantity: number } } }).data.claim;
    expect(claim.quantity).toBe(2);
    expect((await readSlot(slotId)).availableQuantity).toBe(3);
  });

  // -- escrow amount -------------------------------------------------------

  it('the escrow covers the whole claim: amount = price x quantity', { timeout: 30_000 }, async () => {
    const buyer = await loginAs(randomWallet());
    // 1.5 USDT per unit; 3 units must escrow exactly 4.5 USDT = 4500000.
    const slotId = await makeSlot({ total: 5, available: 5, priceUsdt: 1500000n });
    const claim = await postClaim(buyer, slotId, { quantity: 3 });
    expect(claim.statusCode).toBe(200);
    const claimId = (claim.json() as { data: { claim: { id: string } } }).data.claim.id;

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie: buyer, ...CSRF, 'content-type': 'application/json' },
      payload: { token: 'USDT_POLYGON' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as {
      data: {
        escrow: { amount_base_units: string };
        depositInstruction: { usdtAmount: string; approveAmount: string };
      };
    };
    // Exact BigInt math: 1500000 x 3. Never a float, never the unit price.
    expect(body.data.escrow.amount_base_units).toBe('4500000');
    // And the instruction the buyer actually signs for must agree with the
    // snapshot — a mismatch would be an unrecoverable wrong payment.
    expect(body.data.depositInstruction.usdtAmount).toBe('4500000');
    expect(body.data.depositInstruction.approveAmount).toBe('4500000');
  });

  it('a quantity-1 escrow amount is unchanged (regression)', { timeout: 30_000 }, async () => {
    const buyer = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 3, available: 3, priceUsdt: 1500000n });
    const claim = await postClaim(buyer, slotId, { quantity: 1 });
    const claimId = (claim.json() as { data: { claim: { id: string } } }).data.claim.id;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/${claimId}/escrow-intent`,
      headers: { cookie: buyer, ...CSRF, 'content-type': 'application/json' },
      payload: { token: 'USDT_POLYGON' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { data: { escrow: { amount_base_units: string } } };
    expect(body.data.escrow.amount_base_units).toBe('1500000');
  });

  // -- restore paths -------------------------------------------------------

  it('expiry restores the FULL quantity, not one unit per row', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 5, available: 5 });
    await postClaim(cookie, slotId, { quantity: 3 });
    expect((await readSlot(slotId)).availableQuantity).toBe(2);
    await getDb()
      .update(claims)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.slotId, slotId));
    // Lazy expiry runs on the public detail read.
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    const row = await readSlot(slotId);
    // This is the assertion that fails if the restore counts ROWS: 3 units
    // went out, so all 3 must come back, not 1.
    expect(row.availableQuantity).toBe(5);
  });

  it('expiry restores the sum across SEVERAL multi-unit holds', { timeout: 30_000 }, async () => {
    const a = await loginAs(randomWallet());
    const b = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 6, available: 6 });
    await postClaim(a, slotId, { quantity: 2 });
    await postClaim(b, slotId, { quantity: 3 });
    expect((await readSlot(slotId)).availableQuantity).toBe(1);
    await getDb()
      .update(claims)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.slotId, slotId));
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    // Two ROWS expired (2 + 3 = 5 units). A row count would restore 2.
    expect((await readSlot(slotId)).availableQuantity).toBe(6);
  });

  it('expiry un-sells a slot that a multi-unit claim emptied', { timeout: 30_000 }, async () => {
    const cookie = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 2, available: 2 });
    await postClaim(cookie, slotId, { quantity: 2 });
    expect((await readSlot(slotId)).status).toBe('sold_out');
    await getDb()
      .update(claims)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.slotId, slotId));
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    const row = await readSlot(slotId);
    expect(row.availableQuantity).toBe(2);
    expect(row.status).toBe('published');
  });

  it('a restored slot can be re-claimed up to the restored amount', { timeout: 30_000 }, async () => {
    const first = await loginAs(randomWallet());
    const slotId = await makeSlot({ total: 2, available: 2 });
    await postClaim(first, slotId, { quantity: 2 });
    await getDb()
      .update(claims)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.slotId, slotId));
    await app.inject({ method: 'GET', url: `/api/v1/slots/${slotId}` });
    const second = await loginAs(randomWallet());
    const res = await postClaim(second, slotId, { quantity: 2 });
    expect(res.statusCode).toBe(200);
    expect((await readSlot(slotId)).availableQuantity).toBe(0);
  });

  // -- audit ---------------------------------------------------------------

  it('audits the real quantity on claim.created', { timeout: 30_000 }, async () => {
    const wallet = randomWallet();
    const cookie = await loginAs(wallet);
    const buyerId = await userIdFor(wallet);
    const slotId = await makeSlot({ total: 4, available: 4 });
    await postClaim(cookie, slotId, { quantity: 2 });
    const rows = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, buyerId));
    const created = rows.filter((r) => r.eventType === 'claim.created');
    expect(created).toHaveLength(1);
    expect(JSON.stringify(created[0]?.metadata)).toContain('"quantity":2');
  });

  it('a buyer cannot claim their own multi-unit opening', { timeout: 30_000 }, async () => {
    const providerWallet = randomWallet();
    const providerCookie = await loginAs(providerWallet);
    const slotId = await makeSlot({ total: 4, available: 4, providerWallet });
    const res = await postClaim(providerCookie, slotId, { quantity: 2 });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CANNOT_CLAIM_OWN_SLOT');
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
  });

  it('a wallet-less buyer is still gated before any inventory moves', { timeout: 30_000 }, async () => {
    // Phase 5g D5: the wallet gate runs BEFORE the slot lock, so a rejected
    // buyer must not have consumed units.
    const username = `test_5od${tag}`;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'X-Takeover-Client': 'web' },
      payload: { email: `${username}@test.local`, password: 'audit-password-long', username },
    });
    expect(reg.statusCode).toBe(200);
    const cookie = sessionCookieFrom(reg);
    const regUserId = (reg.json() as { data: { user: { id: string } } }).data.user.id;
    const slotId = await makeSlot({ total: 4, available: 4 });
    const res = await postClaim(cookie, slotId, { quantity: 3 });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('WALLET_REQUIRED');
    expect((await readSlot(slotId)).availableQuantity).toBe(4);
    expect(await readClaims(slotId)).toHaveLength(0);
    // The email test user is cleaned by the batch below via its wallet list;
    // it has none, so remove it explicitly.
    const db = getDb();
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, regUserId));
    await db.delete(sessions).where(eq(sessions.userId, regUserId));
    await db.delete(users).where(eq(users.id, regUserId));
  });
});