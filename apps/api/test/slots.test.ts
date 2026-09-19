// Integration tests — live DB. Fixtures use a unique per-run tag so
// assertions stay isolated from seed data and other suites.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { getDb, isDatabaseConfigured } from '../../../db/client';
import { slots, users } from '../../../db/schema';

describe.skipIf(!isDatabaseConfigured())('public marketplace (live)', () => {
  const app = buildApp();
  const tag = randomUUID().slice(0, 8);
  const cat = `cat${tag}`;
  const otherCat = `other${tag}`;
  const loc = `Mitte P4 ${tag}`;

  const ids = {
    sooner: randomUUID(),
    later: randomUUID(),
    third: randomUUID(),
    draft: randomUUID(),
    cancelled: randomUUID(),
    expired: randomUUID(),
    soldOut: randomUUID(),
    past: randomUUID(),
  };
  let providerId = '';
  let publishedId = '';

  beforeAll(async () => {
    const db = getDb();
    const inserted = await db
      .insert(users)
      .values({ walletAddress: `NQ00 P4FIXTURE${tag.toUpperCase()}`, role: 'provider' })
      .returning({ id: users.id });
    providerId = inserted[0]?.id ?? '';
    const HOUR = 3_600_000;
    const now = Date.now();
    const row = (
      id: string,
      overrides: Partial<{
        title: string;
        category: string;
        location: string;
        startsAt: Date;
        status: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired';
        available: number;
      }>,
    ) => ({
      id,
      providerId,
      title: overrides.title ?? `P4 ${tag} slot`,
      description: `P4 ${tag} description`,
      category: overrides.category ?? cat,
      locationLabel: overrides.location ?? loc,
      startsAt: overrides.startsAt ?? new Date(now + 2 * HOUR),
      endsAt: new Date(now + 3 * HOUR),
      priceUsdt: 1500000n,
      totalQuantity: 4,
      availableQuantity: overrides.available ?? 4,
      payoutWallet: `NQ00 P4PAYOUT${tag.toUpperCase()}`,
      status: overrides.status ?? ('published' as const),
      publishedAt: new Date(),
    });
    await db.insert(slots).values([
      row(ids.sooner, { title: `P4 ${tag} evening run`, location: 'Kreuzberg', startsAt: new Date(now + 1 * HOUR) }),
      row(ids.later, { title: `P4 ${tag} sunrise yoga`, startsAt: new Date(now + 2 * HOUR) }),
      row(ids.third, { title: `P4 ${tag} pottery class`, category: otherCat, startsAt: new Date(now + 3 * HOUR) }),
      row(ids.draft, { status: 'draft' }),
      row(ids.cancelled, { status: 'cancelled' }),
      row(ids.expired, { status: 'expired', startsAt: new Date(now - 2 * HOUR) }),
      // Sold_out slots stay visible (own start time avoids sort ties).
      row(ids.soldOut, {
        title: `P4 ${tag} sold out supper`,
        status: 'sold_out',
        available: 0,
        startsAt: new Date(now + 1.5 * HOUR),
      }),
      row(ids.past, { startsAt: new Date(now - 1 * HOUR) }),
    ]);
    publishedId = ids.later;
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of Object.values(ids)) {
      await db.delete(slots).where(eq(slots.id, id));
    }
    if (providerId) {
      await db.delete(users).where(eq(users.id, providerId));
    }
    await app.close();
  });

  interface SlotJson {
    id: string;
    title: string;
    status: string;
    starts_at: string;
    price_usdt: unknown;
  }

  interface ListBody {
    data: { slots: SlotJson[]; total: number; limit: number; offset: number };
    requestId: string;
  }

  async function getList(query: string): Promise<{ status: number; body: ListBody }> {
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots${query}` });
    return { status: res.statusCode, body: res.json() as ListBody };
  }

  it('returns only published/sold_out + future slots', async () => {
    const { status, body } = await getList(`?q=P4%20${tag}`);
    expect(status).toBe(200);
    expect(body.data.total).toBe(4);
    const found = body.data.slots.map((s) => s.id);
    expect(found).toContain(ids.soldOut);
    expect(found).not.toContain(ids.draft);
    expect(found).not.toContain(ids.cancelled);
    expect(found).not.toContain(ids.expired);
    expect(found).not.toContain(ids.past);
    const now = Date.now();
    for (const slot of body.data.slots) {
      expect(['published', 'sold_out']).toContain(slot.status);
      expect(new Date(slot.starts_at).getTime()).toBeGreaterThan(now);
    }
    expect(typeof body.requestId).toBe('string');
  });

  it('sorts soonest first by default', async () => {
    const { body } = await getList(`?q=P4%20${tag}`);
    expect(body.data.slots.map((s) => s.id)).toEqual([ids.sooner, ids.soldOut, ids.later, ids.third]);
  });

  it('filters by q across title, description, and location', async () => {
    const { body } = await getList(`?q=sunrise%20yoga`);
    expect(body.data.slots.map((s) => s.id)).toContain(ids.later);
    const locRes = await getList(`?q=${encodeURIComponent(loc)}`);
    expect(locRes.body.data.slots.map((s) => s.id).sort()).toEqual(
      [ids.later, ids.soldOut, ids.third].sort(),
    );
  });

  it('filters by exact category', async () => {
    const { body } = await getList(`?category=${cat}`);
    expect(body.data.total).toBe(3);
    expect(body.data.slots.map((s) => s.id).sort()).toEqual(
      [ids.sooner, ids.soldOut, ids.later].sort(),
    );
  });

  it('rejects limit=51 with 400 (rejected, not clamped)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/slots?limit=51' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
  });

  it('paginates with limit/offset', async () => {
    const first = await getList(`?category=${cat}&limit=1&offset=0`);
    expect(first.body.data.slots.map((s) => s.id)).toEqual([ids.sooner]);
    expect(first.body.data.total).toBe(3);
    const second = await getList(`?category=${cat}&limit=1&offset=1`);
    expect(second.body.data.slots.map((s) => s.id)).toEqual([ids.soldOut]);
    const third = await getList(`?category=${cat}&limit=1&offset=2`);
    expect(third.body.data.slots.map((s) => s.id)).toEqual([ids.later]);
  });

  it('returns the locked public projection (price as string, no privates)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${publishedId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: Record<string, unknown> }; requestId: string };
    expect(typeof body.requestId).toBe('string');
    expect(Object.keys(body.data.slot).sort()).toEqual(
      [
        'available_quantity',
        'category',
        'description',
        'ends_at',
        'id',
        'location_label',
        'price_usdt',
        'providerDisplay',
        'published_at',
        'starts_at',
        'status',
        'title',
        'total_quantity',
      ].sort(),
    );
    expect(body.data.slot['price_usdt']).toBe('1500000');
    expect(body.data.slot).not.toHaveProperty('payout_wallet');
    expect(body.data.slot).not.toHaveProperty('provider_id');
  });

  it('returns the correct published slot by id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${publishedId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: SlotJson } };
    expect(body.data.slot.id).toBe(publishedId);
    expect(body.data.slot.title).toContain('sunrise yoga');
  });

  it('returns 404 for draft, cancelled, expired, and past slots (no existence leak)', async () => {
    for (const id of [ids.draft, ids.cancelled, ids.expired, ids.past]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${id}` });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string }; requestId: string };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(typeof body.requestId).toBe('string');
    }
  });

  it('returns 200 for sold_out slots (still visible)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${ids.soldOut}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { slot: SlotJson } };
    expect(body.data.slot.status).toBe('sold_out');
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/slots/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });
});
