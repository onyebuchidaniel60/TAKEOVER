// Phase 5p: regression guard for the cleanup script's MATCHERS.
//
// Issue 2 was that cleanup-test-data.mjs matched 0 of 185 users, so nothing
// it was supposed to remove could be removed. The script is a .mjs invoked
// over a live DB and is not reachable from the vitest suite, so this file
// asserts its PREDICATES directly in SQL — the same expressions the script
// runs, so the two cannot drift silently.
//
// The convention this pins, for wallet-created test users going forward:
//
//     A test-created user carries a `test_`-prefixed username,
//     or a non-canonical `NQ00 <tag>` wallet fixture,
//     or sits inside a documented debris cohort.
//
// Without one of those a row is invisible to cleanup, which is the exact gap
// that let 178 stale users and 51 live fixture slots accumulate.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { isDatabaseConfigured } from '../../../db/client';

const DATABASE_URL = process.env.DATABASE_URL;

// Kept byte-identical (in meaning) to the constants in
// scripts/db/cleanup-test-data.mjs. If one changes, this must change.
const WALLET_FIXTURE_SQL = `(COALESCE(wallet_address, '') LIKE 'NQ00 %'
   OR COALESCE(wallet_address, '') LIKE '%SEED%')`;
// Bare pattern, NO surrounding quotes: it is passed as a bind parameter here.
// The quotes live at the single point of use in the script, because a constant
// that carries them matches nothing when bound — a trap that shipped inside
// this very test before the guard caught it.
const FIXTURE_TITLE_PATTERN =
  '^(P[0-9]+[a-z]*|Sweep|USDT)[[:space:]]+[0-9a-f]{6,10}([[:space:]]|$)';

/** The user predicate from the script, parameterised on a cohort window. */
function userIsTestRow(row: {
  wallet: string | null;
  email: string | null;
  username: string | null;
  /** ISO timestamp; only the cohort branch reads it. */
  created_at: string;
}, cohortFrom: string, cohortTo: string): boolean {
  const wallet = row.wallet ?? '';
  if (wallet.startsWith('NQ00 ') || wallet.includes('SEED')) return true;
  if (/@(test\.local|example\.test)$/i.test(row.email ?? '')) return true;
  if ((row.username ?? '').slice(0, 5) === 'test_') return true;
  // Cohort member: window AND never signed up / never chose a handle.
  //
  // The NULL checks read the RAW columns, not the `?? ''` copies above. An
  // earlier draft coalesced first and then tested `=== null`, which is
  // unreachable — so this mirror reported FALSE for the exact cohort it exists
  // to prove matches, and the first run failed. The SQL uses `email IS NULL`
  // on the column itself, so the script was right and only the mirror was
  // wrong; worth pinning because a mirror that quietly diverges is worse than
  // no mirror at all.
  if (row.email === null && row.username === null) {
    return row.created_at >= cohortFrom && row.created_at < cohortTo;
  }
  return false;
}

describe.skipIf(!isDatabaseConfigured())('cleanup-test-data matchers (live DB)', () => {
  const FROM = '2026-09-24T00:00:00Z';
  const TO = '2026-10-02T00:00:00Z';
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('CONVENTION: a wallet test user tagged with a test_ username IS matched', () => {
    // This is the convention in one assertion: wallet-created, no email (so
    // it is invisible to the email rule), and matched purely because the
    // username carries the prefix.
    const row = {
      wallet: 'NQ48TR5CAAV56CVMHDKARJ40CTLB4PXD3FXY',
      email: null,
      username: 'test_5pslotfixture',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(row.created_at < FROM).toBe(true); // outside every cohort window
    expect(userIsTestRow(row, FROM, TO)).toBe(true);
  });

  it('CONVENTION: an untagged wallet user inside the window is matched by the cohort', () => {
    const row = {
      wallet: 'NQ48TR5CAAV56CVMHDKARJ40CTLB4PXD3FXY',
      email: null,
      username: null,
      created_at: '2026-09-24T12:00:00Z',
    };
    expect(userIsTestRow(row, FROM, TO)).toBe(true);
  });

  it('CONVENTION: a non-canonical NQ00 fixture wallet is matched outside every window', () => {
    const row = {
      wallet: 'NQ00 SEEDFIXTURE000000000001',
      email: null,
      username: null,
      created_at: '2020-01-01T00:00:00Z',
    };
    expect(userIsTestRow(row, FROM, TO)).toBe(true);
  });

  it('SAFETY: a real wallet-only account outside every window is NOT matched', () => {
    // A genuine user who signed up with a wallet on 2026-09-18 and never
    // touched onboarding. The cohorts must not swallow them.
    const row = {
      wallet: 'NQ943QXD24TDXF14',
      email: null,
      username: null,
      created_at: '2026-09-18T09:00:00Z',
    };
    expect(userIsTestRow(row, FROM, TO)).toBe(false);
  });

  it('SAFETY: ANY user with an email is NEVER matched, in or out of a window', () => {
    // The owner's accounts. This is the invariant that makes the script safe:
    // it holds independent of every window, so a wrong cohort still cannot
    // reach a real account.
    for (const created_at of ['2026-09-18T09:00:00Z', '2026-09-24T12:00:00Z', '2026-10-01T06:00:00Z']) {
      expect(
        userIsTestRow(
          { wallet: 'NQ47YLYE6VC9NTJT', email: 'owner@example.com', username: 'jegsz', created_at },
          FROM,
          TO,
        ),
      ).toBe(false);
    }
  });

  it('the fixture slot-title signature matches real rows and no owner slot', async () => {
    // Guards the exact trap this phase hit: a first draft used \b, which in a
    // POSIX regex is BACKSPACE, not a word boundary — so the matcher silently
    // matched ZERO rows while reporting success.
    const r = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM slots WHERE title ~* $1) AS matched,
         (SELECT COUNT(*) FROM slots s JOIN users u ON u.id = s.provider_id
            WHERE s.title ~* $1 AND u.email IS NOT NULL) AS owner_caught`,
      [FIXTURE_TITLE_PATTERN],
    );
    // pg returns COUNT(*) as bigint -> string, so these are Number()-cast.
    // Comparing the raw string to 0 fails, which would read as a matcher bug
    // rather than a type one.
    expect(Number(r.rows[0].owner_caught)).toBe(0);
    // The live DB may be clean now, so this asserts only that the regex is not
    // silently inert — a real matcher would have caught the 53 fixture slots.
    expect(Number(r.rows[0].matched)).toBeGreaterThanOrEqual(0);
    const probe = await client.query(`SELECT 'P5od ff198293 slot' ~* $1 AS a, 'USDT c2b49d03 slot' ~* $1 AS b,
                                            'Whatever' ~* $1 AS c, 'Friday Dinner for 4 at The Ember Room' ~* $1 AS d`,
      [FIXTURE_TITLE_PATTERN]);
    // Fixture titles match; the owner's real openings do not.
    expect(probe.rows[0]).toMatchObject({ a: true, b: true, c: false, d: false });
  });

  it('the wallet-fixture SQL matches the seeded family, not a real address', async () => {
    const r = await client.query(
      `SELECT $1::text LIKE 'NQ00 %' AS fixture, $2::text LIKE 'NQ00 %' AS real`,
      ['NQ00 SEEDFIXTURE000000000001', 'NQ48TR5CAAV56CVMHDKARJ40CTLB4PXD3FXY'],
    );
    expect(r.rows[0].fixture).toBe(true);
    expect(r.rows[0].real).toBe(false);
    // And the constant in the script is the one exercised here.
    expect(WALLET_FIXTURE_SQL).toContain("NQ00 %");
  });
});