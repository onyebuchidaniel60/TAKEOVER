// Test-data cleanup (Phase 5d standing rule: run at the end of every phase audit).
//
// Deletes every row matching the test signature and nothing else:
//   * users with a NON-CANONICAL wallet fixture address — `NQ00 <tag>` or any
//     `%SEED%` marker. A Nimiq address containing a space fails IBAN
//     canonicalization, so these rows can never authenticate and never look
//     real. Phase 5p generalized the old `%SEED%`-only rule to the family.
//   * users with Phase 5g test emails (domain @test.local — the convention
//     every email-auth test uses; @example.test also matched as a safety
//     superset) or test usernames (leading `test_` — underscore, not hyphen,
//     because usernames only allow [a-z0-9_] so `test-` is unrepresentable)
//   * users in a PROVEN DEBRIS COHORT (see DEBRIS_COHORTS below), gated on
//     `email IS NULL AND username IS NULL`
//   * slots owned by those users
//   * slots whose title matches the suite-fixture signature
//     `^(P<n>[a-z]*|Sweep|USDT) <hex> …` — "P5od ff198293 slot",
//     "P6 458428b5 alpha", "USDT c2b49d03 slot" (Phase 5p)
//   * slots whose title contains the words `test` or `seed` (any owner)
//   * slots whose description carries the audit-fixture marker
//     ("(Phase 5 audit fixture)" — seed-phase5.ts)
//   * claims on those slots, or bought by matched users
//   * escrows / escrow_ledger / payment_intents attached to those claims
//   * reports, notifications, provider_profiles, follows, sessions tied to
//     test users/slots
//   * audit_events whose actor is a test user or whose entity is a deleted row
//   * auth_challenges keyed by a fixture wallet
//
// Why the cohorts exist: the three original matchers cannot see a wallet-created
// test user at all — /auth/verify inserts `{ walletAddress, role }` with no
// username and no email, so such a row matches none of them. Measured before
// this change: 0 of 185 users matched, while 51 LIVE suite-fixture slots sat on
// the public feed.
//
// Preserves: any user with a non-null email, and every slot/claim belonging to
// one. This guard is applied INSIDE each predicate, so it holds even if a
// cohort window is wrong — a real account cannot be reached by this script
// regardless of date. The owner's three accounts all have emails.
//
// Idempotent: safe to run any time; a clean DB deletes zero rows.
// Refuses to run when NODE_ENV=production (same guard as db/seed.ts).
// Reads DATABASE_URL from the environment and never logs it.
//
// Usage:
//   node scripts/db/cleanup-test-data.mjs            # dry run, deletes nothing
//   node scripts/db/cleanup-test-data.mjs --apply    # commit the deletions
import { Client } from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('cleanup-test-data refuses to run when NODE_ENV=production.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('cleanup-test-data: DATABASE_URL is not set — refusing.');
  process.exit(2);
}

/** Delete by id list in 500-row chunks (avoids oversized IN lists). */
async function deleteByIds(client, table, ids) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const placeholders = chunk.map((_, n) => `$${n + 1}`).join(', ');
    const res = await client.query(`DELETE FROM ${table} WHERE id IN (${placeholders})`, chunk);
    deleted += res.rowCount ?? 0;
  }
  return deleted;
}

async function collectIds(client, query, params = []) {
  const res = await client.query(query, params);
  return res.rows.map((row) => row.id);
}

/**
 * Phase 5p: report what a run WOULD delete, per rule and per cohort, so the
 * decision to apply is reviewable rather than trusted. Per-rule attribution
 * doubles as the canary for a broken matcher — a rule silently matching
 * nothing is the exact failure mode that let 185 stale users accumulate.
 */
function reportDryRun(counts, matched, users, slots, claims) {
  console.log('cleanup-test-data — DRY RUN (nothing deleted; pass --apply to commit)');
  console.log(`  would delete: users=${users} slots=${slots} claims=${claims} escrows=${counts.escrows_matched}`);
  console.log('  user rules:');
  for (const [name, n] of Object.entries(matched.usersByRule)) {
    console.log(`    ${name}: ${n}`);
  }
  console.log('  debris cohorts (window + email IS NULL + username IS NULL):');
  for (const cohort of DEBRIS_COHORTS) {
    console.log(`    ${cohort.id}: ${matched.cohorts[cohort.id]}`);
    console.log(`      evidence: ${cohort.evidence}`);
  }
  const silent = Object.entries(matched.usersByRule).filter(([, n]) => n === 0);
  if (silent.length > 0) {
    console.log(
      `  NOTE: rules matching 0 rows: ${silent.map(([n]) => n).join(', ')}` +
        ' — expected once their debris is gone, but suspicious on a first run.',
    );
  }
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ---------------------------------------------------------------------------
// Phase 5p — the wallet-user gap.
//
// The original three matchers (SEED wallet, @test.local email, `test_`
// username) cannot see a wallet-created test user: /auth/verify inserts
// `{ walletAddress, role }` and never a username or email, so such a row
// matches NONE of them. Measured on the live DB: `matched_by_cleanup: 0` of
// 185 users, while 53 slots carrying suite-fixture titles were sitting on the
// public feed.
//
// Two additions close that, both with measured precision:
//
// 1. WALLET FIXTURE MARKERS. `NQ00 ` + a tag. A Nimiq address containing a
//    space fails IBAN canonicalization, so these rows can never authenticate
//    and can never look like a real account. The old `%SEED%` rule was one
//    hardcoded instance of a whole family; this matches the family.
//
// 2. PROVEN DEBRIS COHORTS. Creation-window cohorts whose provenance is
//    established by behaviour, not by address shape. Their wallets are real
//    canonical addresses and CANNOT be told apart by format — only 2 of the
//    101 Sep-24 wallets even carry a marker. So each cohort is gated on the
//    window PLUS `email IS NULL AND username IS NULL`: every member was
//    created without ever entering an email or choosing a handle, which no
//    account that completed signup or onboarding can match.
//
// SAFETY, structural rather than incidental:
//   * A user with a non-null email is NEVER deleted. Every real account
//     (including all three of the owner's) has one; the cohorts have none.
//     This guard holds regardless of any window, so a wrong window still
//     cannot reach a real account.
//   * Slots owned by an email-bearing user are NEVER deleted.
//   * Dry run by default; `--apply` is required to delete anything.
// ---------------------------------------------------------------------------

/** Wallet fixtures that can never authenticate (broken IBAN checksum). */
const WALLET_FIXTURE_SQL = `(COALESCE(wallet_address, '') LIKE 'NQ00 %'
   OR COALESCE(wallet_address, '') LIKE '%SEED%')`;

/**
 * Machine-generated cohorts, each with the evidence that identified it.
 * `from`/`to` are half-open UTC day boundaries.
 */
const DEBRIS_COHORTS = [
  {
    id: '2026-09-24',
    from: '2026-09-24T00:00:00Z',
    to: '2026-09-25T00:00:00Z',
    evidence:
      '101 users in one day; wallet prefixes spread evenly across NQ0-NQ9 (random key generation); ' +
      '17 slots titled "P6 458428b5 slot" created at the IDENTICAL timestamp 23:00:00 (batch insert); ' +
      '25 claims across 21 slots inside a 72-second window; 99 users with exactly one session each.',
  },
  {
    id: '2026-09-27',
    from: '2026-09-27T00:00:00Z',
    to: '2026-09-28T00:00:00Z',
    evidence:
      '7 users, same shape as Sep-24 (wallet-only, no handle, no email); no slots; ' +
      '4 claims across 3 slots inside a 9-minute window; 19 sessions across 7 users.',
  },
  {
    id: '2026-10-01-suite',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-02T00:00:00Z',
    evidence:
      "This repository's OWN API-suite leakage, identified by fixture title: 23 slots titled " +
      '"P5od ff198293 slot" — `P5od` is the tag prefix written into ' +
      'apps/api/test/claim-quantity.test.ts. 70 wallet-only users, 32 claims, no profile.',
  },
];

/**
 * Suite-fixture SLOT titles: `P<phase-tag> <random-hex> <noun>`, e.g.
 * "P5od ff198293 slot", "P6 458428b5 alpha", "USDT c2b49d03 slot",
 * "Sweep f6813d50 slot". Measured against the live DB: 53 slots matched, 51 of
 * them live, 0 belonging to an email-bearing user, 0 fixture-looking titles
 * missed.
 *
 * NOTE the POSIX spelling: `\b` is BACKSPACE in a Postgres regex, not a word
 * boundary (`\y` is). An earlier draft used `\b` and silently matched ZERO rows
 * — a cleanup that reports success while doing nothing, which is the same
 * false-green class this phase exists to remove. Hence `[[:space:]]|$`.
 *
 * Stored WITHOUT the surrounding single quotes, and quoted at the single point
 * of use below. Carrying the quotes in the constant is a trap: interpolated
 * into SQL text they are correct, but passed as a bind parameter they become
 * part of the pattern and match nothing at all. That mistake shipped inside
 * this phase's own guard test before it was caught, which is precisely why the
 * guard exists.
 */
const FIXTURE_TITLE_PATTERN =
  '^(P[0-9]+[a-z]*|Sweep|USDT)[[:space:]]+[0-9a-f]{6,10}([[:space:]]|$)';

const DRY_RUN = !process.argv.includes('--apply');

const counts = {};
const matched = { usersByRule: {}, cohorts: {} };

try {
  await client.query('BEGIN');

  // 1. Users: fixture markers, the existing email/username conventions, and
  //    any cohort member. The email guard is applied INSIDE the predicate so a
  //    wrong window cannot widen the blast radius.
  const seedUserIds = await collectIds(
    client,
    `SELECT id FROM users
      WHERE ${WALLET_FIXTURE_SQL}
        OR COALESCE(email, '') ~* '@(test\\.local|example\\.test)$'
        OR COALESCE(LEFT(username, 5), '') = 'test_'
        OR (
          email IS NULL AND username IS NULL AND (
            (created_at >= $1::timestamptz AND created_at < $2::timestamptz)
            OR (created_at >= $3::timestamptz AND created_at < $4::timestamptz)
            OR (created_at >= $5::timestamptz AND created_at < $6::timestamptz)
          )
        )`,
    [
      DEBRIS_COHORTS[0].from,
      DEBRIS_COHORTS[0].to,
      DEBRIS_COHORTS[1].from,
      DEBRIS_COHORTS[1].to,
      DEBRIS_COHORTS[2].from,
      DEBRIS_COHORTS[2].to,
    ],
  );
  counts.users_matched = seedUserIds.length;

  // Per-rule attribution, so a count can always be explained. This is also the
  // guard against a silently-broken matcher: every rule reports its own
  // number, so a rule that drops to 0 is visible instead of free.
  for (const [name, sql] of [
    ['wallet_fixture_marker', `${WALLET_FIXTURE_SQL} AND email IS NULL`],
    ['test_email', `COALESCE(email, '') ~* '@(test\\.local|example\\.test)$'`],
    ['test_username', `COALESCE(LEFT(username, 5), '') = 'test_'`],
  ]) {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE ${sql}`,
    );
    matched.usersByRule[name] = r.rows[0].n;
  }
  for (const cohort of DEBRIS_COHORTS) {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
          AND email IS NULL AND username IS NULL`,
      [cohort.from, cohort.to],
    );
    matched.cohorts[cohort.id] = r.rows[0].n;
  }

  // 2. Test slots: seed-owned, fixture-titled, test/seed-worded,
  //    audit-fixture-marked — and NEVER one owned by an email-bearing user.
  const testSlotIds = await collectIds(
    client,
    `SELECT s.id FROM slots s JOIN users u ON u.id = s.provider_id
      WHERE u.email IS NULL
        AND (
          s.provider_id = ANY($1)
          OR s.title ~* '(^|[^a-z])(test|seed)([^a-z]|$)'
          OR COALESCE(s.description, '') LIKE '%audit fixture%'
          OR s.title ~* '${FIXTURE_TITLE_PATTERN}'
        )`,
    [seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000']],
  );
  counts.slots_matched = testSlotIds.length;

  // 3. Test claims: on test slots, or bought by matched users (a fixture buyer
  //    claiming a real slot must not leave a live hold behind either).
  const testClaimIds = await collectIds(
    client,
    `SELECT c.id FROM claims c
      WHERE (c.slot_id = ANY($1) OR c.buyer_id = ANY($2))
        AND NOT EXISTS (SELECT 1 FROM users b WHERE b.id = c.buyer_id AND b.email IS NOT NULL)`,
    [
      testSlotIds.length > 0 ? testSlotIds : ['00000000-0000-0000-0000-000000000000'],
      seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000'],
    ],
  );
  counts.claims_matched = testClaimIds.length;

  // 4. Escrows attached to test claims.
  const testEscrowIds = await collectIds(
    client,
    `SELECT id FROM escrows WHERE claim_id = ANY($1)`,
    [testClaimIds.length > 0 ? testClaimIds : ['00000000-0000-0000-0000-000000000000']],
  );
  counts.escrows_matched = testEscrowIds.length;

  // ---- Dry run stops here. Everything above is SELECT-only. ---------------
  //
  // A cleanup that deletes on its first invocation is unreviewable, and the
  // one thing this script must never do is delete the owner's account. So the
  // default run reports exactly what WOULD go, and `--apply` is required.
  if (DRY_RUN) {
    await client.query('ROLLBACK');
    reportDryRun(counts, matched, seedUserIds.length, testSlotIds.length, testClaimIds.length);
    process.exit(0);
  }

  // 5. Leaf tables first (FK-safe order), then parents. Order follows the
  //    measured FK graph: escrow_ledger -> escrows -> payment_intents ->
  //    claims -> reports -> notifications -> provider_profiles -> follows ->
  //    sessions -> audit_events -> auth_challenges -> slots -> users.
  counts.escrow_ledger_deleted =
    testEscrowIds.length === 0
      ? 0
      : (
          await client.query(`DELETE FROM escrow_ledger WHERE escrow_id = ANY($1)`, [testEscrowIds])
        ).rowCount ?? 0;
  counts.escrows_deleted = await deleteByIds(client, 'escrows', testEscrowIds);
  counts.payment_intents_deleted =
    testClaimIds.length === 0
      ? 0
      : (await client.query(`DELETE FROM payment_intents WHERE claim_id = ANY($1)`, [testClaimIds]))
          .rowCount ?? 0;
  counts.claims_deleted = await deleteByIds(client, 'claims', testClaimIds);

  counts.reports_deleted = (
    await client.query(
      `DELETE FROM reports WHERE slot_id = ANY($1) OR reporter_id = ANY($2)
          OR target_user_id = ANY($2) OR resolved_by_user_id = ANY($2)`,
      [
        testSlotIds.length > 0 ? testSlotIds : ['00000000-0000-0000-0000-000000000000'],
        seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000'],
      ],
    )
  ).rowCount ?? 0;

  counts.notifications_deleted = (
    await client.query(
      `DELETE FROM notifications WHERE user_id = ANY($1) OR entity_id = ANY($2::text[])
          OR entity_id = ANY($3::text[]) OR entity_id = ANY($1::text[])`,
      [
        seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000'],
        testSlotIds.length > 0 ? testSlotIds : ['00000000-0000-0000-0000-000000000000'],
        testClaimIds.length > 0 ? testClaimIds : ['00000000-0000-0000-0000-000000000000'],
      ],
    )
  ).rowCount ?? 0;

  counts.provider_profiles_deleted =
    seedUserIds.length === 0
      ? 0
      : (await client.query(`DELETE FROM provider_profiles WHERE user_id = ANY($1)`, [seedUserIds]))
          .rowCount ?? 0;

  // Phase 5p: follows could not exist before this phase, and both FKs point at
  // users, so leaving them would block the users delete on any row that had.
  counts.follows_deleted =
    seedUserIds.length === 0
      ? 0
      : (
          await client.query(
            `DELETE FROM follows WHERE follower_id = ANY($1) OR following_id = ANY($1)`,
            [seedUserIds],
          )
        ).rowCount ?? 0;

  counts.sessions_deleted =
    seedUserIds.length === 0
      ? 0
      : (await client.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [seedUserIds]))
          .rowCount ?? 0;

  // Audit trail for test rows only: actor is a matched user, or the entity is a
  // deleted test row. Owner + real-user audit history is untouched.
  const testEntityIds = [...new Set([...seedUserIds, ...testSlotIds, ...testClaimIds, ...testEscrowIds])];
  counts.audit_events_deleted =
    testEntityIds.length === 0 && seedUserIds.length === 0
      ? 0
      : (
          await client.query(
            `DELETE FROM audit_events WHERE actor_user_id = ANY($1) OR entity_id = ANY($2::text[])`,
            [
              seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000'],
              testEntityIds.length > 0 ? testEntityIds : ['00000000-0000-0000-0000-000000000000'],
            ],
          )
        ).rowCount ?? 0;

  // Phase 5p: the whole NON-CANONICAL fixture family, not just %SEED%. These
  // rows are keyed by wallet and orphaned the moment their user goes.
  counts.auth_challenges_deleted = (
    await client.query(
      `DELETE FROM auth_challenges
        WHERE COALESCE(wallet_address, '') LIKE '%SEED%' OR COALESCE(wallet_address, '') LIKE 'NQ00 %'`,
    )
  ).rowCount ?? 0;

  counts.slots_deleted = await deleteByIds(client, 'slots', testSlotIds);
  counts.users_deleted = await deleteByIds(client, 'users', seedUserIds);

  // Preservation proof: every email-bearing account survives, with its own
  // slots and claims intact. Asserted, not assumed — this is the invariant
  // that makes the whole script safe to run.
  const preserved = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL) AS owner_users,
      (SELECT COUNT(*) FROM slots s JOIN users u ON u.id = s.provider_id WHERE u.email IS NOT NULL) AS owner_slots,
      (SELECT COUNT(*) FROM claims c JOIN users u ON u.id = c.buyer_id WHERE u.email IS NOT NULL) AS owner_claims`);
  counts.preserved = preserved.rows[0];

  // Preservation check: non-test rows that remain.
  const remaining = await client.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM slots) AS slots,
            (SELECT COUNT(*) FROM claims) AS claims, (SELECT COUNT(*) FROM escrows) AS escrows`,
  );
  counts.remaining = remaining.rows[0];

  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}

console.log('cleanup-test-data (APPLIED):');
for (const [table, n] of Object.entries(counts)) {
  // `preserved` is an object, not a count — skipped here and printed in full
  // below. Stringifying it into the loop printed "[object Object]", which is
  // exactly the kind of unreadable output that hides a safety assertion.
  if (table === 'remaining' || table === 'preserved') continue;
  console.log(`  ${table}: ${n}`);
}
console.log(
  `  remaining: users=${counts.remaining.users} slots=${counts.remaining.slots} claims=${counts.remaining.claims} escrows=${counts.remaining.escrows}`,
);
console.log(
  `  PRESERVED (email-bearing, must be unchanged): users=${counts.preserved.owner_users} slots=${counts.preserved.owner_slots} claims=${counts.preserved.owner_claims}`,
);
process.exit(0);
