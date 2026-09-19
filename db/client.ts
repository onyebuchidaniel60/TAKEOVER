import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Lazy database client factory (connects on first use).
let db: NodePgDatabase | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): NodePgDatabase {
  if (db) {
    return db;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not configured. Set it in .env (see .env.example).');
  }
  db = drizzle(new Pool({ connectionString: url, max: resolvePoolMax() }));
  return db;
}

// Test-infrastructure chore: bound each process's pg Pool so that
// (vitest forks x poolMax) stays below Supabase Supavisor's 15-session
// session-mode cap. Production default is unchanged (10). Test mode sets
// PGPOOL_MAX=3 via apps/api/vitest.config.ts (3 forks x 3 = 9 < 15).
// Blank or invalid values fall back to 10.
function resolvePoolMax(): number {
  const raw = process.env.PGPOOL_MAX?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}
