import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '../../../db/client';

// Live connectivity check. Runs only when DATABASE_URL is configured
// (local Supabase); otherwise it skips so `npm run test` stays green offline.
describe.skipIf(!isDatabaseConfigured())('database connectivity (live)', () => {
  it('connects via getDb() and runs SELECT 1', async () => {
    const db = getDb();
    const result = await db.execute(sql`SELECT 1 AS one`);
    expect(result.rows).toHaveLength(1);
  });
});
