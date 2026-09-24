// Phase 5 audit fixtures: one buyer claim + escrow row per escrow state
// (created, funded, delivered, disputed, releasing, released, refunding,
// refunded) on eight separate seed slots.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/audit/seed-phase5.ts            # seed, print claim ids
//   DATABASE_URL=... npx tsx scripts/audit/seed-phase5.ts --mint-session   # + print a session cookie
//   DATABASE_URL=... npx tsx scripts/audit/seed-phase5.ts --revoke-sessions # delete audit sessions
//
// Idempotency: fixed UUIDs + onConflictDoNothing (re-runs never
// duplicate; edited rows are NOT updated). The audit buyer wallet
// carries the SEED marker so it can never authenticate via wallet —
// the audit harness mints a real session row instead (same format as
// createSessionToken: <uuid>.<base64url-secret>, SHA-256 stored).
// Seed rows are disposable fixtures retained by design (db/seed.ts
// convention); minted sessions are revoked by the audit wrapper.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { slots, users } from '../../db/schema';
import { claims } from '../../db/schema/claims';
import { escrows } from '../../db/schema/escrows';
import { sessions } from '../../db/schema/auth';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-phase5 refuses to run when NODE_ENV=production.');
  process.exit(1);
}

const PROVIDER_ID = '11111111-1111-4111-8111-000000000001';
const BUYER_ID = '33333333-3333-4333-8333-000000000001';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Fixture {
  state: string;
  slotSuffix: string;
  claimSuffix: string;
  escrowSuffix: string;
  title: string;
  priceUsdt: bigint;
  claimStatus: string;
  escrowStatus: string;
  holdInMs: number;
}

const EVM = (ch: string): string => `0x${ch.repeat(40)}`;
const TX = (ch: string): string => `0x${ch.repeat(64)}`;

const FIXTURES: Fixture[] = [
  { state: 'created', slotSuffix: '01', claimSuffix: '01', escrowSuffix: '01', title: 'Gallery preview — open seats', priceUsdt: 1500000n, claimStatus: 'active_hold', escrowStatus: 'created', holdInMs: 1 * HOUR },
  { state: 'funded', slotSuffix: '02', claimSuffix: '02', escrowSuffix: '02', title: 'Chef’s counter — single seat', priceUsdt: 1500000n, claimStatus: 'escrow_funded', escrowStatus: 'funded', holdInMs: 1 * HOUR },
  { state: 'delivered', slotSuffix: '03', claimSuffix: '03', escrowSuffix: '03', title: 'Massage — sixty minutes', priceUsdt: 100000n, claimStatus: 'delivered', escrowStatus: 'delivered', holdInMs: -1 * HOUR },
  { state: 'disputed', slotSuffix: '04', claimSuffix: '04', escrowSuffix: '04', title: 'Jazz night — two seats', priceUsdt: 2500000n, claimStatus: 'disputed', escrowStatus: 'disputed', holdInMs: -1 * HOUR },
  { state: 'releasing', slotSuffix: '05', claimSuffix: '05', escrowSuffix: '05', title: 'Tasting menu — four seats', priceUsdt: 1234560000n, claimStatus: 'delivered', escrowStatus: 'releasing', holdInMs: -1 * HOUR },
  { state: 'released', slotSuffix: '06', claimSuffix: '06', escrowSuffix: '06', title: 'Brunch table — weekend', priceUsdt: 500000n, claimStatus: 'released', escrowStatus: 'released', holdInMs: -1 * HOUR },
  { state: 'refunding', slotSuffix: '07', claimSuffix: '07', escrowSuffix: '07', title: 'Beard trim — express slot', priceUsdt: 10000n, claimStatus: 'escrow_funded', escrowStatus: 'refunding', holdInMs: -1 * HOUR },
  { state: 'refunded', slotSuffix: '08', claimSuffix: '08', escrowSuffix: '08', title: 'Spin class — 8 bikes', priceUsdt: 750000n, claimStatus: 'refunded', escrowStatus: 'refunded', holdInMs: -1 * HOUR },
];

const slotId = (f: Fixture): string => `44444444-4444-4422-8422-0000000000${f.slotSuffix}`;
const claimId = (f: Fixture): string => `55555555-5555-4522-8522-0000000000${f.claimSuffix}`;
const escrowId = (f: Fixture): string => `66666666-6666-4622-8622-0000000000${f.escrowSuffix}`;

async function seed(): Promise<Record<string, string>> {
  const db = getDb();
  const now = new Date();
  const ids: Record<string, string> = {};

  await db.insert(users).values([
    { id: PROVIDER_ID, walletAddress: 'NQ00 SEEDFIXTURE000000000001', role: 'provider' as const },
    { id: BUYER_ID, walletAddress: 'NQ00 SEEDFIXTURE000000000009', role: 'buyer' as const },
  ]).onConflictDoNothing();

  for (const [i, f] of FIXTURES.entries()) {
    const start = new Date(now.getTime() + (2 + i) * DAY);
    await db.insert(slots).values({
      id: slotId(f),
      providerId: PROVIDER_ID,
      title: f.title,
      description: `${f.title} (Phase 5 audit fixture).`,
      category: 'Event',
      locationLabel: 'Mitte',
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * HOUR),
      priceUsdt: f.priceUsdt,
      totalQuantity: 4,
      availableQuantity: 3,
      status: 'published' as const,
      publishedAt: now,
    }).onConflictDoNothing();

    await db.insert(claims).values({
      id: claimId(f),
      slotId: slotId(f),
      buyerId: BUYER_ID,
      quantity: 1,
      status: f.claimStatus as 'active_hold',
      holdExpiresAt: new Date(now.getTime() + f.holdInMs),
      claimedAt: new Date(now.getTime() - HOUR),
      depositSubmittedAt: f.claimStatus === 'active_hold' ? null : new Date(now.getTime() - 50 * 60_000),
    }).onConflictDoNothing();

    // The 'created' fixture has NO escrow row (fresh active_hold exercises
    // the live escrow-intent fetch in the audit).
    if (f.escrowStatus !== 'created') {
      const fundedSide = {
        // Tx hashes are UNIQUE-when-present: derive every one from the
        // fixture suffix so no two rows collide (a collision silently
        // skips the insert under onConflictDoNothing).
        depositTxHash: `0x${'d'.repeat(60)}00${f.claimSuffix}`,
        fundedAt: new Date(now.getTime() - 50 * 60_000),
        deliveryDeadline: new Date(now.getTime() + 23 * HOUR),
      };
      await db.insert(escrows).values({
        id: escrowId(f),
        claimId: claimId(f),
        buyerId: BUYER_ID,
        providerId: PROVIDER_ID,
        paymentToken: 'USDT_POLYGON' as const,
        amountBaseUnits: f.priceUsdt,
        status: f.escrowStatus as 'funded',
        ...fundedSide,
        contractAddress: EVM('7f'),
        onChainEscrowId: TX('c5').slice(0, 66),
        providerPayoutAddress: ['delivered', 'disputed', 'releasing', 'released'].includes(f.escrowStatus) ? EVM('aa') : null,
        deliveredAt: ['delivered', 'disputed', 'releasing', 'released'].includes(f.escrowStatus) ? new Date(now.getTime() - 20 * 60_000) : null,
        disputeWindowEnds: ['delivered', 'disputed'].includes(f.escrowStatus) ? new Date(now.getTime() + DAY) : null,
        disputedAt: f.escrowStatus === 'disputed' ? new Date(now.getTime() - 10 * 60_000) : null,
        releaseTxHash: ['releasing', 'released'].includes(f.escrowStatus) ? `0x${'e'.repeat(60)}10${f.claimSuffix}` : null,
        refundTxHash: ['refunding', 'refunded'].includes(f.escrowStatus) ? `0x${'f'.repeat(60)}20${f.claimSuffix}` : null,
        resolvedAt: ['released', 'refunded'].includes(f.escrowStatus) ? new Date(now.getTime() - 5 * 60_000) : null,
      }).onConflictDoNothing();
    }
    ids[f.state] = claimId(f);
  }

  // One draft slot owned by the audit buyer (sell-detail + publish-flow
  // measurements). Fixed UUID, idempotent like the rest.
  await db.insert(slots).values({
    id: '44444444-4444-4422-8422-000000000009',
    providerId: BUYER_ID,
    title: 'Audit draft — do not publish',
    description: 'Phase 5 perf fixture.',
    category: 'Event',
    locationLabel: 'Mitte',
    startsAt: new Date(now.getTime() + 3 * DAY),
    endsAt: new Date(now.getTime() + 3 * DAY + 2 * HOUR),
    priceUsdt: 1000000n,
    totalQuantity: 2,
    availableQuantity: 2,
    status: 'draft' as const,
  }).onConflictDoNothing();
  ids.draftSlot = '44444444-4444-4422-8422-000000000009';
  return ids;
}

async function mintSession(): Promise<{ name: string; value: string }> {
  const db = getDb();
  const sessionId = randomUUID();
  const secret = randomBytes(32);
  const tokenHash = createHash('sha256').update(secret).digest('hex');
  await db.insert(sessions).values({
    id: sessionId,
    userId: BUYER_ID,
    tokenHash,
    expiresAt: new Date(Date.now() + 2 * HOUR),
    revokedAt: null,
  });
  return { name: 'takeover_session', value: `${sessionId}.${secret.toString('base64url')}` };
}

async function revokeSessions(): Promise<number> {
  const db = getDb();
  const res = await db.delete(sessions).where(eq(sessions.userId, BUYER_ID)).returning({ id: sessions.id });
  return res.length;
}

const mode = process.argv[2] ?? 'seed';
if (mode === '--mint-session') {
  const ids = await seed();
  const cookie = await mintSession();
  console.log(JSON.stringify({ claims: ids, cookie }));
} else if (mode === '--revoke-sessions') {
  const n = await revokeSessions();
  console.log(JSON.stringify({ revoked: n }));
} else {
  const ids = await seed();
  console.log(JSON.stringify({ claims: ids }));
}
process.exit(0);
