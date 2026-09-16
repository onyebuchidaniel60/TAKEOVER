// Phase 14d-1 escrow schema constraint tests (live DB, direct inserts — no
// app, no auth, no network). Fixtures use unique per-run tags; everything
// created here is deleted afterwards in FK order.
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { claims } from '../../../db/schema/claims';
import { escrowLedger, escrows } from '../../../db/schema/escrows';
import { slots } from '../../../db/schema/slots';
import { users } from '../../../db/schema/users';

interface PgError {
  code?: string;
}

async function pgErrorOf(promise: Promise<unknown>): Promise<PgError | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err ?? {}) as PgError;
  }
}

describe.skipIf(!isDatabaseConfigured())('escrow schema constraints (live)', () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const slotIds: string[] = [];
  const claimIds: string[] = [];
  const escrowIds: string[] = [];
  let walletSeq = 0;
  let hashSeq = 0;

  function wallet(): string {
    walletSeq += 1;
    return `TEST-14D1-${tag}-${walletSeq}`;
  }

  function txHash(): string {
    hashSeq += 1;
    return `test14d1${tag.replace(/-/g, '')}${String(hashSeq).padStart(4, '0')}`;
  }

  async function makeUser(): Promise<string> {
    const db = getDb();
    const rows = await db.insert(users).values({ walletAddress: wallet() }).returning({ id: users.id });
    userIds.push(rows[0].id);
    return rows[0].id;
  }

  async function makeSlot(providerId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .insert(slots)
      .values({
        providerId,
        title: `escrow schema ${tag}`,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
        priceNim: 150000n,
        totalQuantity: 4,
        availableQuantity: 4,
        payoutWallet: wallet(),
      })
      .returning({ id: slots.id });
    slotIds.push(rows[0].id);
    return rows[0].id;
  }

  async function makeClaim(
    slotId: string,
    buyerId: string,
    status: 'active_hold' | 'deposit_submitted' | 'released' = 'active_hold',
  ): Promise<string> {
    const db = getDb();
    const rows = await db
      .insert(claims)
      .values({ slotId, buyerId, status, holdExpiresAt: new Date(Date.now() + 600_000) })
      .returning({ id: claims.id });
    claimIds.push(rows[0].id);
    return rows[0].id;
  }

  afterAll(async () => {
    const db = getDb();
    if (escrowIds.length > 0) {
      await db.delete(escrowLedger).where(inArray(escrowLedger.escrowId, escrowIds));
      await db.delete(escrows).where(inArray(escrows.id, escrowIds));
    }
    if (claimIds.length > 0) {
      await db.delete(claims).where(inArray(claims.id, claimIds));
    }
    if (slotIds.length > 0) {
      await db.delete(slots).where(inArray(slots.id, slotIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("inserts a 'created' escrow with NULL deposit fields", async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const claimId = await makeClaim(slotId, buyerId);
    const rows = await db
      .insert(escrows)
      .values({ claimId, buyerId, providerId, paymentToken: 'NIM', amountBaseUnits: 150000n })
      .returning({ id: escrows.id, status: escrows.status, fundedAt: escrows.fundedAt });
    escrowIds.push(rows[0].id);
    expect(rows[0].status).toBe('created');
    expect(rows[0].fundedAt).toBeNull();
  });

  it("rejects a 'funded' escrow with a NULL deposit_tx_hash (CHECK)", async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const claimId = await makeClaim(slotId, buyerId);
    const err = await pgErrorOf(
      db.insert(escrows).values({
        claimId,
        buyerId,
        providerId,
        paymentToken: 'NIM',
        amountBaseUnits: 150000n,
        status: 'funded',
        fundedAt: new Date(),
        deliveryDeadline: new Date(Date.now() + 3_600_000),
      }),
    );
    expect(err?.code).toBe('23514');
    await db.delete(claims).where(eq(claims.id, claimId));
    claimIds.splice(claimIds.indexOf(claimId), 1);
  });

  it("inserts a 'funded' escrow with the full funded tuple", async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const claimId = await makeClaim(slotId, buyerId);
    const rows = await db
      .insert(escrows)
      .values({
        claimId,
        buyerId,
        providerId,
        paymentToken: 'USDT_POLYGON',
        amountBaseUnits: 1000000n,
        status: 'funded',
        depositTxHash: txHash(),
        fundedAt: new Date(),
        deliveryDeadline: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: escrows.id, status: escrows.status });
    escrowIds.push(rows[0].id);
    expect(rows[0].status).toBe('funded');
  });

  it('rejects a second escrow for one claim (claim_id UNIQUE)', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const claimId = await makeClaim(slotId, buyerId);
    const first = await db
      .insert(escrows)
      .values({ claimId, buyerId, providerId, paymentToken: 'NIM', amountBaseUnits: 150000n })
      .returning({ id: escrows.id });
    escrowIds.push(first[0].id);
    const err = await pgErrorOf(
      db.insert(escrows).values({ claimId, buyerId, providerId, paymentToken: 'NIM', amountBaseUnits: 150000n }),
    );
    expect(err?.code).toBe('23505');
  });

  it('rejects duplicate deposit/release/refund tx hashes across escrows', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const fundedAt = new Date();
    const deliveryDeadline = new Date(Date.now() + 3_600_000);
    const deposit = txHash();
    const release = txHash();
    const refund = txHash();
    const firstClaim = await makeClaim(slotId, buyerId);
    const first = await db
      .insert(escrows)
      .values({
        claimId: firstClaim,
        buyerId,
        providerId,
        paymentToken: 'NIM',
        amountBaseUnits: 150000n,
        status: 'funded',
        depositTxHash: deposit,
        releaseTxHash: release,
        refundTxHash: refund,
        fundedAt,
        deliveryDeadline,
      })
      .returning({ id: escrows.id });
    escrowIds.push(first[0].id);
    const funded = { buyerId, providerId, paymentToken: 'NIM', amountBaseUnits: 150000n, fundedAt, deliveryDeadline } as const;
    const secondBuyer = await makeUser();
    const secondClaim = await makeClaim(slotId, secondBuyer);
    const dupDeposit = await pgErrorOf(
      db.insert(escrows).values({ ...funded, claimId: secondClaim, buyerId: secondBuyer, status: 'funded', depositTxHash: deposit }),
    );
    expect(dupDeposit?.code).toBe('23505');
    await db.delete(claims).where(eq(claims.id, secondClaim));
    claimIds.splice(claimIds.indexOf(secondClaim), 1);
    const thirdBuyer = await makeUser();
    const thirdClaim = await makeClaim(slotId, thirdBuyer);
    const dupRelease = await pgErrorOf(
      db.insert(escrows).values({
        ...funded,
        claimId: thirdClaim,
        buyerId: thirdBuyer,
        status: 'funded',
        depositTxHash: txHash(),
        releaseTxHash: release,
      }),
    );
    expect(dupRelease?.code).toBe('23505');
    await db.delete(claims).where(eq(claims.id, thirdClaim));
    claimIds.splice(claimIds.indexOf(thirdClaim), 1);
    const fourthBuyer = await makeUser();
    const fourthClaim = await makeClaim(slotId, fourthBuyer);
    const dupRefund = await pgErrorOf(
      db.insert(escrows).values({
        ...funded,
        claimId: fourthClaim,
        buyerId: fourthBuyer,
        status: 'funded',
        depositTxHash: txHash(),
        refundTxHash: refund,
      }),
    );
    expect(dupRefund?.code).toBe('23505');
    await db.delete(claims).where(eq(claims.id, fourthClaim));
    claimIds.splice(claimIds.indexOf(fourthClaim), 1);
  });

  it('rejects two deposit_submitted claims for the same buyer+slot', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    await makeClaim(slotId, buyerId, 'deposit_submitted');
    const err = await pgErrorOf(
      db.insert(claims).values({ slotId, buyerId, status: 'deposit_submitted', holdExpiresAt: new Date(Date.now() + 600_000) }),
    );
    expect(err?.code).toBe('23505');
  });

  it('rejects deposit_submitted alongside active_hold for the same buyer+slot', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    await makeClaim(slotId, buyerId, 'active_hold');
    const err = await pgErrorOf(
      db.insert(claims).values({ slotId, buyerId, status: 'deposit_submitted', holdExpiresAt: new Date(Date.now() + 600_000) }),
    );
    expect(err?.code).toBe('23505');
  });

  it('allows released rows to repeat for the same buyer+slot', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const buyerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const first = await makeClaim(slotId, buyerId, 'released');
    const second = await db
      .insert(claims)
      .values({ slotId, buyerId, status: 'released', holdExpiresAt: new Date(Date.now() + 600_000) })
      .returning({ id: claims.id });
    claimIds.push(second[0].id);
    expect(second[0].id).not.toBe(first);
  });

  it('escrow_status carries the 14d-3b transitional states refunding and releasing', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const fundedAt = new Date(Date.now() - 1000);
    const deliveryDeadline = new Date(Date.now() + 3_600_000);
    for (const status of ['refunding', 'releasing'] as const) {
      const loopBuyer = await makeUser();
      const claimId = await makeClaim(slotId, loopBuyer);
      const inserted = await db
        .insert(escrows)
        .values({
          claimId,
          buyerId: loopBuyer,
          providerId,
          paymentToken: 'USDT_POLYGON',
          amountBaseUnits: 150000n,
          status,
          depositTxHash: txHash(),
          fundedAt,
          deliveryDeadline,
          refundTxHash: status === 'refunding' ? txHash() : null,
          releaseTxHash: status === 'releasing' ? txHash() : null,
        })
        .returning({ id: escrows.id, status: escrows.status });
      escrowIds.push(inserted[0].id);
      expect(inserted[0].status).toBe(status);
    }
  });

  it('slots carries a nullable 14d-4 provider_contact_note', async () => {
    const db = getDb();
    const providerId = await makeUser();
    const slotId = await makeSlot(providerId);
    const fresh = await db
      .select({ note: slots.providerContactNote })
      .from(slots)
      .where(eq(slots.id, slotId))
      .limit(1);
    expect(fresh[0]?.note).toBeNull();
    const written = await db
      .update(slots)
      .set({ providerContactNote: 'Meet at the side door.' })
      .where(eq(slots.id, slotId))
      .returning({ note: slots.providerContactNote });
    expect(written[0]?.note).toBe('Meet at the side door.');
  });
});
