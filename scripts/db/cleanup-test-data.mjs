// Test-data cleanup (Phase 5d standing rule: run at the end of every phase audit).
//
// Deletes every row matching the test signature and nothing else:
//   * users with SEED-marker wallet addresses (NQ00 SEEDFIXTURE… — db/seed.ts,
//     scripts/audit/seed-phase5.ts). The SEED marker breaks the Nimiq IBAN
//     checksum, so these wallets can never authenticate and never look real.
//   * users with Phase 5g test emails (domain @test.local — the convention
//     every email-auth test uses; @example.test also matched as a safety
//     superset) or test usernames (leading `test_` — underscore, not hyphen,
//     because usernames only allow [a-z0-9_] so `test-` is unrepresentable)
//   * slots owned by those users
//   * slots with a `test-` or `seed-` title prefix (any owner)
//   * slots whose description carries the audit-fixture marker
//     ("(Phase 5 audit fixture)" — seed-phase5.ts)
//   * claims on those slots, or bought by seed users
//   * escrows / escrow_ledger / payment_intents attached to those claims
//   * reports, notifications, provider_profiles, sessions tied to test users/slots
//   * audit_events whose actor is a test user or whose entity is a deleted row
//   * auth_challenges keyed by SEED-marker wallets
//
// Preserves: the owner's own user row and published slots, and any row that
// does not match the test signature (every DELETE is keyed on collected ids).
//
// Idempotent: safe to run any time; a clean DB deletes zero rows.
// Refuses to run when NODE_ENV=production (same guard as db/seed.ts).
// Reads DATABASE_URL from the environment and never logs it.
//
// Usage:
//   node scripts/db/cleanup-test-data.mjs
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

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const counts = {};
try {
  await client.query('BEGIN');

  // 1. Seed users: the SEED marker can never authenticate (checksum break).
  //    Plus Phase 5g email-identity test users: @test.local is the convention
  //    every email-auth test uses (@example.test matched as a safety
  //    superset); test usernames lead with `test_`. Domain match is
  //    end-anchored so test.localevil.com-style addresses never match.
  const seedUserIds = await collectIds(
    client,
    `SELECT id FROM users WHERE wallet_address LIKE '%SEED%'
       OR email ~* '@(test\\.local|example\\.test)$'
       OR LEFT(username, 5) = 'test_'`,
  );
  counts.users_matched = seedUserIds.length;

  // 2. Test slots: seed-owned, title-prefixed, or audit-fixture-marked.
  const testSlotIds = await collectIds(
    client,
    `SELECT id FROM slots WHERE provider_id = ANY($1)
       OR title ILIKE 'test-%' OR title ILIKE 'seed-%'
       OR description LIKE '%audit fixture%'`,
    [seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000']],
  );
  counts.slots_matched = testSlotIds.length;

  // 3. Test claims: on test slots, or bought by seed users (a fixture buyer
  //    claiming a real slot must not leave a live hold behind either).
  const testClaimIds = await collectIds(
    client,
    `SELECT id FROM claims WHERE slot_id = ANY($1) OR buyer_id = ANY($2)`,
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

  // 5. Leaf tables first (FK-safe order), then parents.
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
      `DELETE FROM reports WHERE slot_id = ANY($1) OR reporter_id = ANY($2) OR target_user_id = ANY($2)`,
      [
        testSlotIds.length > 0 ? testSlotIds : ['00000000-0000-0000-0000-000000000000'],
        seedUserIds.length > 0 ? seedUserIds : ['00000000-0000-0000-0000-000000000000'],
      ],
    )
  ).rowCount ?? 0;

  counts.notifications_deleted = (
    await client.query(
      `DELETE FROM notifications WHERE user_id = ANY($1) OR entity_id = ANY($2::text[]) OR entity_id = ANY($3::text[]) OR entity_id = ANY($1::text[])`,
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

  counts.sessions_deleted =
    seedUserIds.length === 0
      ? 0
      : (await client.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [seedUserIds]))
          .rowCount ?? 0;

  // Audit trail for test rows only: actor is a seed user, or the entity is a
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

  counts.auth_challenges_deleted = (
    await client.query(`DELETE FROM auth_challenges WHERE wallet_address LIKE '%SEED%'`)
  ).rowCount ?? 0;

  counts.slots_deleted = await deleteByIds(client, 'slots', testSlotIds);
  counts.users_deleted = await deleteByIds(client, 'users', seedUserIds);

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

console.log('cleanup-test-data done:');
for (const [table, n] of Object.entries(counts)) {
  if (table === 'remaining') continue;
  console.log(`  ${table}: ${n}`);
}
console.log(
  `  remaining: users=${counts.remaining.users} slots=${counts.remaining.slots} claims=${counts.remaining.claims} escrows=${counts.remaining.escrows}`,
);
process.exit(0);
