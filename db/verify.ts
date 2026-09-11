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
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
