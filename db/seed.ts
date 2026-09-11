// Phase 4 tooling: demo seed data for the public marketplace.
// Reads DATABASE_URL from the environment and never logs it.
// Usage (value stays in your shell, never printed):
//   npm.cmd run db:seed
//
// Fixture wallet pattern: `NQ00 SEEDFIXTURE00000000000X` (providers) and
// `NQ00 SEEDPAYOUT000000000000X` (payout wallets). The `SEED…` marker breaks
// the Nimiq IBAN checksum (mod97), so wallet-auth canonicalization ALWAYS
// rejects these addresses — no seed user can ever authenticate, and no seed
// row looks like a real wallet. No real PII anywhere. Phase 5+ must treat
// these rows as disposable fixtures (safe to delete/ignore).
//
// Idempotency: every row uses a FIXED UUID plus onConflictDoNothing, so
// re-running never duplicates. (Re-running does not update edited rows.)

import { getDb } from './client';
import { slots, users } from './schema';

if (process.env.NODE_ENV === 'production') {
  console.error('db:seed refuses to run when NODE_ENV=production.');
  process.exit(1);
}

const PROVIDERS = [
  { id: '11111111-1111-4111-8111-000000000001', wallet: 'NQ00 SEEDFIXTURE000000000001' },
  { id: '11111111-1111-4111-8111-000000000002', wallet: 'NQ00 SEEDFIXTURE000000000002' },
  { id: '11111111-1111-4111-8111-000000000003', wallet: 'NQ00 SEEDFIXTURE000000000003' },
  { id: '11111111-1111-4111-8111-000000000004', wallet: 'NQ00 SEEDFIXTURE000000000004' },
  { id: '11111111-1111-4111-8111-000000000005', wallet: 'NQ00 SEEDFIXTURE000000000005' },
] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface SeedSlot {
  id: string;
  provider: number;
  title: string;
  description: string;
  category: string;
  location: string;
  startsInMs: number;
  endsInMs: number | null;
  priceNim: bigint;
  total: number;
  available: number;
  status: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'expired';
}

const PUBLISHED = 'published' as const;

// 15 published future slots (one with 0 left to exercise the sold-out UI),
// plus edge states: 2 draft, 1 cancelled, 2 expired (past), 1 sold_out.
const SEED_SLOTS: SeedSlot[] = [
  {
    id: '22222222-2222-4222-8222-000000000001',
    provider: 0,
    title: 'Table for two — tonight',
    description: 'A cozy corner table released for this evening. Two seats, dinner service.',
    category: 'dining',
    location: 'Mitte',
    startsInMs: 2 * HOUR,
    endsInMs: 4 * HOUR,
    priceNim: 4500000n,
    total: 2,
    available: 2,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000002',
    provider: 1,
    title: 'Sunrise yoga — 4 spots',
    description: 'Morning flow class with spare mats. All levels welcome.',
    category: 'fitness',
    location: 'Kreuzberg',
    startsInMs: 6 * HOUR,
    endsInMs: 7 * HOUR,
    priceNim: 1500000n,
    total: 4,
    available: 4,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000003',
    provider: 2,
    title: 'Tennis court — evening hour',
    description: 'Outdoor hard court freed up by a cancellation. Rackets included.',
    category: 'sports',
    location: 'Charlottenburg',
    startsInMs: 8 * HOUR,
    endsInMs: 9 * HOUR,
    priceNim: 2000000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000004',
    provider: 3,
    title: 'Haircut slot — tomorrow morning',
    description: 'Thirty-minute cut with a senior stylist. Walk in ready.',
    category: 'beauty',
    location: 'Neukölln',
    startsInMs: 26 * HOUR,
    endsInMs: 26 * HOUR + 30 * 60_000,
    priceNim: 2500000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000005',
    provider: 4,
    title: 'Jazz night — two seats',
    description: 'Late-set seats at an intimate basement show. Doors at eight.',
    category: 'events',
    location: 'Mitte',
    startsInMs: 30 * HOUR,
    endsInMs: 32 * HOUR,
    priceNim: 3000000n,
    total: 2,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000006',
    provider: 0,
    title: 'Brunch table — weekend',
    description: 'Window table for a late-morning brunch, seats up to four.',
    category: 'dining',
    location: 'Prenzlauer Berg',
    startsInMs: 3 * DAY,
    endsInMs: 3 * DAY + 2 * HOUR,
    priceNim: 6000000n,
    total: 4,
    available: 4,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000007',
    provider: 1,
    title: 'Spin class — 8 bikes',
    description: 'High-energy evening ride. Towels and water provided.',
    category: 'fitness',
    location: 'Friedrichshain',
    startsInMs: 3 * DAY + 5 * HOUR,
    endsInMs: 3 * DAY + 6 * HOUR,
    priceNim: 800000n,
    total: 8,
    available: 6,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000008',
    provider: 2,
    title: 'Padel court — doubles hour',
    description: 'Covered padel court for four players, balls included.',
    category: 'sports',
    location: 'Tempelhof',
    startsInMs: 4 * DAY,
    endsInMs: 4 * DAY + HOUR,
    priceNim: 3500000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000009',
    provider: 3,
    title: 'Beard trim — express slot',
    description: 'Fifteen-minute sharp trim between appointments.',
    category: 'beauty',
    location: 'Kreuzberg',
    startsInMs: 5 * DAY,
    endsInMs: 5 * DAY + 15 * 60_000,
    priceNim: 900000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000010',
    provider: 4,
    title: 'Gallery preview — open seats',
    description: 'Early access to a new exhibition opening, drinks included.',
    category: 'events',
    location: 'Mitte',
    startsInMs: 6 * DAY,
    endsInMs: 6 * DAY + 3 * HOUR,
    priceNim: 1000000n,
    total: 12,
    available: 9,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000011',
    provider: 0,
    title: 'Chef’s counter — single seat',
    description: 'One counter seat for the tasting menu, released last minute.',
    category: 'dining',
    location: 'Schöneberg',
    startsInMs: 8 * DAY,
    endsInMs: 8 * DAY + 2 * HOUR,
    priceNim: 7500000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000012',
    provider: 1,
    title: 'Pilates reformer — duo session',
    description: 'Small-group reformer class, two machines open.',
    category: 'fitness',
    location: 'Moabit',
    startsInMs: 9 * DAY,
    endsInMs: 9 * DAY + HOUR,
    priceNim: 1800000n,
    total: 2,
    available: 2,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000013',
    provider: 2,
    title: 'Badminton hall — open play',
    description: 'Evening open-play session, all levels. Rackets to borrow.',
    category: 'sports',
    location: 'Wedding',
    startsInMs: 10 * DAY,
    endsInMs: 10 * DAY + 2 * HOUR,
    priceNim: 500000n,
    total: 10,
    available: 7,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000014',
    provider: 3,
    title: 'Massage — sixty minutes',
    description: 'Relaxation massage slot from a late cancellation.',
    category: 'beauty',
    location: 'Charlottenburg',
    startsInMs: 12 * DAY,
    endsInMs: 12 * DAY + HOUR,
    priceNim: 4200000n,
    total: 1,
    available: 1,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000015',
    provider: 4,
    title: 'Comedy night — front row',
    description: 'Two front-row seats for the late show. Just released.',
    category: 'events',
    location: 'Kreuzberg',
    startsInMs: 2 * DAY,
    endsInMs: 2 * DAY + 2 * HOUR,
    priceNim: 2750000n,
    total: 2,
    available: 0,
    status: PUBLISHED,
  },
  {
    id: '22222222-2222-4222-8222-000000000016',
    provider: 0,
    title: 'Draft: wine tasting (unlisted)',
    description: 'Not yet published — must never appear in the marketplace.',
    category: 'dining',
    location: 'Mitte',
    startsInMs: 2 * DAY,
    endsInMs: 2 * DAY + 2 * HOUR,
    priceNim: 3000000n,
    total: 6,
    available: 6,
    status: 'draft',
  },
  {
    id: '22222222-2222-4222-8222-000000000017',
    provider: 1,
    title: 'Draft: boxing intro (unlisted)',
    description: 'Still being prepared — must never appear in the marketplace.',
    category: 'fitness',
    location: 'Kreuzberg',
    startsInMs: 4 * DAY,
    endsInMs: 4 * DAY + HOUR,
    priceNim: 1200000n,
    total: 4,
    available: 4,
    status: 'draft',
  },
  {
    id: '22222222-2222-4222-8222-000000000018',
    provider: 2,
    title: 'Cancelled: squash ladder (gone)',
    description: 'Withdrawn by the provider — must never appear.',
    category: 'sports',
    location: 'Tempelhof',
    startsInMs: 4 * DAY,
    endsInMs: 4 * DAY + HOUR,
    priceNim: 1500000n,
    total: 2,
    available: 2,
    status: 'cancelled',
  },
  {
    id: '22222222-2222-4222-8222-000000000019',
    provider: 3,
    title: 'Expired: yesterday’s facial (past)',
    description: 'Already started in the past — must never appear.',
    category: 'beauty',
    location: 'Neukölln',
    startsInMs: -2 * DAY,
    endsInMs: -2 * DAY + HOUR,
    priceNim: 2000000n,
    total: 1,
    available: 1,
    status: 'expired',
  },
  {
    id: '22222222-2222-4222-8222-000000000020',
    provider: 4,
    title: 'Expired: last night’s gig (past)',
    description: 'Show already happened — must never appear.',
    category: 'events',
    location: 'Mitte',
    startsInMs: -5 * HOUR,
    endsInMs: -3 * HOUR,
    priceNim: 1800000n,
    total: 30,
    available: 12,
    status: 'expired',
  },
  {
    id: '22222222-2222-4222-8222-000000000021',
    provider: 0,
    title: 'Sold out: tasting menu (gone)',
    description: 'Every seat claimed — must never appear in the public list.',
    category: 'dining',
    location: 'Schöneberg',
    startsInMs: 7 * DAY,
    endsInMs: 7 * DAY + 3 * HOUR,
    priceNim: 9000000n,
    total: 8,
    available: 0,
    status: 'sold_out',
  },
];

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .insert(users)
    .values(
      PROVIDERS.map((p) => ({
        id: p.id,
        walletAddress: p.wallet,
        role: 'provider' as const,
      })),
    )
    .onConflictDoNothing();
  console.log(`seed users ok (${PROVIDERS.length} fixture providers)`);

  await db
    .insert(slots)
    .values(
      SEED_SLOTS.map((s, i) => ({
        id: s.id,
        providerId: PROVIDERS[s.provider]?.id ?? PROVIDERS[0]?.id ?? '',
        title: s.title,
        description: s.description,
        category: s.category,
        locationLabel: s.location,
        startsAt: new Date(now.getTime() + s.startsInMs),
        endsAt: s.endsInMs === null ? null : new Date(now.getTime() + s.endsInMs),
        priceNim: s.priceNim,
        totalQuantity: s.total,
        availableQuantity: s.available,
        payoutWallet: `NQ00 SEEDPAYOUT00000000000${i + 1}`,
        status: s.status,
        publishedAt: s.status === 'draft' ? null : now,
        cancelledAt: s.status === 'cancelled' ? now : null,
        expiredAt: s.status === 'expired' ? now : null,
      })),
    )
    .onConflictDoNothing();
  console.log(`seed slots ok (${SEED_SLOTS.length} fixture slots)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
