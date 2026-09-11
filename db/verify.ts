// Phase 2 tooling: connectivity check + schema confirmation.
// Reads DATABASE_URL from the environment and never logs it.
// Usage (values stay in your shell, never printed):
//   npm.cmd run db:verify [-- --expect-empty]

import { sql } from 'drizzle-orm';
import { getDb } from './client';

const expectEmpty = process.argv.includes('--expect-empty');

async function main(): Promise<void> {
  // Throws (without revealing the URL) when DATABASE_URL is missing.
  const db = getDb();

  await db.execute(sql`SELECT 1`);
  console.log('connectivity: SELECT 1 ok');

  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const names = tables.rows.map((row) => row.table_name);
  console.log(`tables (${names.length}): ${names.join(', ') || '(none)'}`);

  if (expectEmpty && names.length > 0) {
    throw new Error(`expected an empty database, found ${names.length} table(s)`);
  }

  // Phase 2 follow-up: confirm the additive columns exist.
  const expectedColumns = [
    'users.disabled_at',
    'slots.cancelled_at',
    'slots.expired_at',
    'claims.quantity',
    'reports.resolved_by_user_id',
    'reports.resolution_notes',
    'audit_events.request_id',
  ];
  const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const present = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = expectedColumns.filter((col) => !present.has(col));
  console.log(
    `follow-up columns ok (${expectedColumns.length - missing.length}/${expectedColumns.length})`,
  );
  if (missing.length > 0) {
    throw new Error(`missing columns: ${missing.join(', ')}`);
  }

  // Confirm the corrected partial-unique-index predicate (paid must be absent).
  const indexDef = await db.execute<{ indexdef: string }>(sql`
    SELECT pg_get_indexdef(indexrelid) AS indexdef
    FROM pg_index
    WHERE indexrelid = 'public.claims_one_active_per_buyer_slot'::regclass
  `);
  const def = indexDef.rows[0]?.indexdef ?? '(missing)';
  console.log(`partial index: ${def}`);
  const wanted = ["'active_hold'", "'payment_pending'", "'payment_review'"];
  if (!wanted.every((s) => def.includes(s)) || def.includes("'paid'")) {
    throw new Error('claims partial index predicate does not match the reconciled definition');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
